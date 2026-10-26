"""Catalog use cases, deterministic stock and transactional audit history."""

from datetime import UTC, datetime
from typing import cast
from unicodedata import normalize
from uuid import UUID

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from locatto_api.auth import Identity
from locatto_api.catalog_contracts import (
    MAX_QUANTITY,
    CategoryCreate,
    KitCreate,
    KitEdit,
    MaintenanceCommand,
    PhotoEdit,
    ProductCreate,
    ProductEdit,
    ReasonCommand,
    StockAdjustment,
    aggregate_items,
)
from locatto_api.catalog_models import (
    CatalogHistory,
    CatalogRecord,
    Kit,
    KitItem,
    MaintenanceEntry,
    Product,
    ProductCategory,
    ProductPhoto,
    StockMovement,
)
from locatto_api.catalog_storage import (
    CatalogError,
    PhotoStorage,
    normalize_image,
)
from locatto_api.database import session_scope
from locatto_api.operations import active_operation
from locatto_api.rental_effects import record_inventory_impact


def product_snapshot(product: Product) -> dict[str, object]:
    return {
        "id": str(product.id),
        "name": product.name,
        "price": str(product.price),
        "description": product.description,
        "category": product.category,
        "color": product.color,
        "dimensions": product.dimensions,
        "observation": product.observation,
        "replacement_value": str(product.replacement_value)
        if product.replacement_value is not None
        else None,
        "total_quantity": product.total_quantity,
        "maintenance_quantity": product.maintenance_quantity,
        "apt_quantity": product.total_quantity - product.maintenance_quantity,
        "is_active": product.is_active,
        "version": product.version,
        "created_by": str(product.created_by),
        "updated_by": str(product.updated_by),
        "created_at": product.created_at.isoformat(),
        "updated_at": product.updated_at.isoformat(),
    }


def photo_snapshot(photo: ProductPhoto) -> dict[str, object]:
    return {
        "id": str(photo.id),
        "format": photo.format,
        "size": photo.size,
        "sha256": photo.sha256,
        "order": photo.position,
        "is_principal": photo.is_principal,
    }


def custody_stock_movement(
    session: Session,
    product: Product,
    actor: Identity,
    operation: str,
    quantity: int,
    reason: str,
    now: datetime,
    entry: MaintenanceEntry | None = None,
) -> MaintenanceEntry | None:
    """Caller owns the product lock; custody and catalog commit together."""
    if operation == "maintenance":
        if quantity > product.total_quantity - product.maintenance_quantity:
            raise CatalogError(409, "Estoque físico insuficiente para manutenção.")
        product.maintenance_quantity += quantity
        entry = MaintenanceEntry(
            product_id=product.id,
            quantity=quantity,
            released_quantity=0,
            reason=reason,
            created_at=now,
        )
        session.add(entry)
    elif operation in {"release", "withdrawal"}:
        if entry is not None:
            if quantity > entry.quantity - entry.released_quantity:
                raise CatalogError(409, "Quantidade supera o saldo de manutenção.")
            entry.released_quantity += quantity
            product.maintenance_quantity -= quantity
        if operation == "withdrawal":
            if product.total_quantity - quantity < product.maintenance_quantity:
                raise CatalogError(
                    409, "Baixa física compromete unidades em manutenção."
                )
            product.total_quantity -= quantity
    else:
        raise ValueError("Unsupported physical custody movement.")
    product.version += 1
    product.updated_by, product.updated_at = actor.user_id, now
    session.add(
        StockMovement(
            product_id=product.id,
            actor_id=actor.user_id,
            session_id=actor.session_id,
            operation=operation,
            reason=reason,
            quantity=quantity,
            total_after=product.total_quantity,
            maintenance_after=product.maintenance_quantity,
            created_at=now,
        )
    )
    session.add(
        CatalogHistory(
            product_id=product.id,
            actor_id=actor.user_id,
            session_id=actor.session_id,
            operation=operation,
            reason=reason,
            snapshot=product_snapshot(product),
            created_at=now,
        )
    )
    session.flush()
    return entry


class CatalogService:
    def __init__(self, factory: sessionmaker[Session], storage: PhotoStorage) -> None:
        self.factory = factory
        self.storage = storage

    def list_categories(
        self, search: str, page: int, page_size: int
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            clause = ProductCategory.name.icontains(search, autoescape=True)
            total = (
                session.scalar(
                    select(func.count()).select_from(ProductCategory).where(clause)
                )
                or 0
            )
            rows = session.scalars(
                select(ProductCategory)
                .where(clause)
                .order_by(func.lower(ProductCategory.name), ProductCategory.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            return {
                "items": [{"id": str(row.id), "name": row.name} for row in rows],
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    def create_category(
        self, payload: CategoryCreate, actor: Identity
    ) -> dict[str, object]:
        try:
            with session_scope(self.factory) as session:
                # Category registration is rare; serialize its Unicode comparison
                # rather than depending on the database's locale-specific lower().
                session.execute(text("SELECT pg_advisory_xact_lock(731614, 13)"))
                key = normalize("NFC", payload.name).casefold()
                if any(
                    normalize("NFC", name).casefold() == key
                    for name in session.scalars(select(ProductCategory.name))
                ):
                    raise CatalogError(
                        409, "Esta categoria já está cadastrada. Selecione-a na lista."
                    )
                category = ProductCategory(name=payload.name, created_by=actor.user_id)
                session.add(category)
                session.flush()
                result: dict[str, object] = {
                    "id": str(category.id),
                    "name": category.name,
                }
                session.commit()
                return result
        except IntegrityError as error:
            if getattr(error.orig, "sqlstate", None) != "23505":
                raise
            raise CatalogError(
                409, "Esta categoria já está cadastrada. Selecione-a na lista."
            ) from None

    def _require_category(self, session: Session, name: str | None) -> str | None:
        if not name:
            return None
        if (
            session.scalar(
                select(ProductCategory.id).where(ProductCategory.name == name)
            )
            is None
        ):
            raise CatalogError(422, "Selecione uma categoria cadastrada.")
        return name

    def _commit_product(self, session: Session, product: Product) -> dict[str, object]:
        # Assemble the response while the row lock still protects this version.
        session.flush()
        result = self._product_detail(session, product)
        session.commit()
        return result

    def _locked(
        self,
        session: Session,
        model: type[Product] | type[Kit],
        identifier: UUID,
        version: int,
    ) -> Product | Kit:
        record = session.scalar(
            select(model).where(model.id == identifier).with_for_update()
        )
        if record is None:
            raise CatalogError(404, "Cadastro não encontrado.")
        assert isinstance(record, Product | Kit)
        if record.version != version:
            raise CatalogError(
                409,
                "Outra pessoa alterou este cadastro. Seu rascunho foi mantido; "
                "consulte a versão atual antes de tentar novamente.",
            )
        return record

    def _touch(self, record: CatalogRecord, actor: Identity) -> None:
        record.version += 1
        record.updated_at = datetime.now(UTC)
        record.updated_by = actor.user_id

    def _audit(
        self,
        session: Session,
        record: Product | Kit,
        actor: Identity,
        operation: str,
        reason: str,
        snapshot: dict[str, object],
    ) -> None:
        session.add(
            CatalogHistory(
                product_id=record.id if isinstance(record, Product) else None,
                kit_id=record.id if isinstance(record, Kit) else None,
                actor_id=actor.user_id,
                session_id=actor.session_id,
                operation=operation,
                reason=reason,
                snapshot=snapshot,
            )
        )

    def _movement(
        self,
        session: Session,
        product: Product,
        actor: Identity,
        operation: str,
        reason: str,
        quantity: int,
    ) -> None:
        session.add(
            StockMovement(
                product_id=product.id,
                actor_id=actor.user_id,
                session_id=actor.session_id,
                operation=operation,
                reason=reason,
                quantity=quantity,
                total_after=product.total_quantity,
                maintenance_after=product.maintenance_quantity,
            )
        )

    def create_product(
        self, payload: ProductCreate, actor: Identity
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            fields = payload.model_dump(exclude={"initial_quantity"})
            fields["category"] = self._require_category(session, payload.category)
            product = Product(
                **fields,
                total_quantity=payload.initial_quantity,
                maintenance_quantity=0,
                created_by=actor.user_id,
                updated_by=actor.user_id,
            )
            session.add(product)
            session.flush()
            self._movement(
                session,
                product,
                actor,
                "initial",
                "Estoque inicial no cadastro",
                payload.initial_quantity,
            )
            self._audit(
                session,
                product,
                actor,
                "created",
                "Cadastro inicial",
                product_snapshot(product),
            )
            return self._commit_product(session, product)

    def edit_product(
        self, identifier: UUID, payload: ProductEdit, actor: Identity
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            record = self._locked(
                session, Product, identifier, payload.expected_version
            )
            assert isinstance(record, Product)
            fields = payload.model_dump(exclude={"expected_version"})
            fields["category"] = self._require_category(session, payload.category)
            for key, value in fields.items():
                setattr(record, key, value)
            self._touch(record, actor)
            self._audit(
                session,
                record,
                actor,
                "edited",
                "Edição cadastral",
                product_snapshot(record),
            )
            return self._commit_product(session, record)

    def inactivate(
        self, kind: str, identifier: UUID, payload: ReasonCommand, actor: Identity
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            record = self._locked(
                session,
                Product if kind == "products" else Kit,
                identifier,
                payload.expected_version,
            )
            if not record.is_active:
                raise CatalogError(409, "Cadastro já está inativo.")
            record.is_active = False
            self._touch(record, actor)
            snapshot = (
                product_snapshot(record)
                if isinstance(record, Product)
                else self._kit_snapshot(session, record)
            )
            self._audit(session, record, actor, "inactivated", payload.reason, snapshot)
            session.flush()
            result = (
                self._product_detail(session, record)
                if isinstance(record, Product)
                else self._kit_detail(session, record)
            )
            session.commit()
            return result

    def adjust_stock(
        self, identifier: UUID, payload: StockAdjustment, actor: Identity
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            product = self._locked(
                session, Product, identifier, payload.expected_version
            )
            assert isinstance(product, Product)
            total = (
                payload.quantity
                if payload.operation == "correction"
                else product.total_quantity
                + (
                    payload.quantity
                    if payload.operation == "entry"
                    else -payload.quantity
                )
            )
            if not product.maintenance_quantity <= total <= MAX_QUANTITY:
                raise CatalogError(
                    422,
                    "Total deve ser válido e cobrir as unidades em manutenção. "
                    "Libere a manutenção antes de reduzir essas unidades.",
                )
            product.total_quantity = total
            self._touch(product, actor)
            self._movement(
                session,
                product,
                actor,
                payload.operation,
                payload.reason,
                payload.quantity,
            )
            record_inventory_impact(session, product, actor)
            return self._commit_product(session, product)

    def maintenance(
        self, identifier: UUID, payload: MaintenanceCommand, actor: Identity
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            product = self._locked(
                session, Product, identifier, payload.expected_version
            )
            assert isinstance(product, Product)
            if payload.quantity > product.total_quantity - product.maintenance_quantity:
                raise CatalogError(
                    422, "Quantidade supera as unidades aptas do cadastro."
                )
            product.maintenance_quantity += payload.quantity
            session.add(
                MaintenanceEntry(
                    product_id=identifier,
                    quantity=payload.quantity,
                    reason=payload.reason,
                )
            )
            self._touch(product, actor)
            self._movement(
                session, product, actor, "maintenance", payload.reason, payload.quantity
            )
            record_inventory_impact(session, product, actor)
            return self._commit_product(session, product)

    def release(
        self,
        identifier: UUID,
        entry_id: UUID,
        payload: MaintenanceCommand,
        actor: Identity,
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            product = self._locked(
                session, Product, identifier, payload.expected_version
            )
            assert isinstance(product, Product)
            entry = session.get(MaintenanceEntry, entry_id)
            if entry is None or entry.product_id != identifier:
                raise CatalogError(404, "Manutenção não encontrada neste produto.")
            from locatto_api.handover_models import Incident

            if session.scalar(
                select(Incident.id).where(Incident.maintenance_id == entry_id)
            ):
                raise CatalogError(
                    409,
                    "Libere esta manutenção pela ocorrência da locação, "
                    "respeitando o recebimento real.",
                )
            if payload.quantity > entry.quantity - entry.released_quantity:
                raise CatalogError(422, "Quantidade supera o saldo desta manutenção.")
            entry.released_quantity += payload.quantity
            product.maintenance_quantity -= payload.quantity
            self._touch(product, actor)
            self._movement(
                session, product, actor, "release", payload.reason, payload.quantity
            )
            return self._commit_product(session, product)

    def _kit_items(self, session: Session, kit: Kit) -> list[dict[str, object]]:
        rows = session.execute(
            select(KitItem, Product)
            .join(Product, KitItem.product_id == Product.id)
            .where(KitItem.kit_id == kit.id)
            .order_by(Product.name, Product.id)
        ).all()
        return [
            {
                "product_id": str(product.id),
                "name": product.name,
                "quantity": item.quantity,
                "is_active": product.is_active,
            }
            for item, product in rows
        ]

    def _kit_snapshot(self, session: Session, kit: Kit) -> dict[str, object]:
        items = self._kit_items(session, kit)
        return {
            "id": str(kit.id),
            "name": kit.name,
            "price": str(kit.price),
            "is_active": kit.is_active,
            "version": kit.version,
            "created_by": str(kit.created_by),
            "updated_by": str(kit.updated_by),
            "created_at": kit.created_at.isoformat(),
            "updated_at": kit.updated_at.isoformat(),
            "items": items,
            "needs_review": any(not item["is_active"] for item in items),
        }

    def save_kit(
        self,
        payload: KitCreate | KitEdit,
        actor: Identity,
        identifier: UUID | None = None,
    ) -> dict[str, object]:
        try:
            quantities = aggregate_items(payload.items)
        except ValueError:
            raise CatalogError(422, "Quantidade de componente inválida.") from None
        with session_scope(self.factory) as session:
            if identifier is None:
                kit = Kit(
                    name=payload.name,
                    price=payload.price,
                    created_by=actor.user_id,
                    updated_by=actor.user_id,
                )
                session.add(kit)
                session.flush()
                operation = "created"
            else:
                assert isinstance(payload, KitEdit)
                record = self._locked(
                    session, Kit, identifier, payload.expected_version
                )
                assert isinstance(record, Kit)
                kit = record
                kit.name, kit.price = payload.name, payload.price
                self._touch(kit, actor)
                operation = "edited"
            products = session.scalars(
                select(Product)
                .where(Product.id.in_(quantities))
                .order_by(Product.id)
                .with_for_update(read=True)
            ).all()
            if len(products) != len(quantities) or any(
                not product.is_active for product in products
            ):
                raise CatalogError(
                    409,
                    "Selecione somente produtos existentes e ativos. "
                    "Remova ou substitua o componente inativo para revisar o kit.",
                )
            session.execute(delete(KitItem).where(KitItem.kit_id == kit.id))
            session.add_all(
                [
                    KitItem(kit_id=kit.id, product_id=key, quantity=value)
                    for key, value in quantities.items()
                ]
            )
            session.flush()
            self._audit(
                session,
                kit,
                actor,
                operation,
                "Composição e preço comercial",
                self._kit_snapshot(session, kit),
            )
            session.flush()
            result = self._kit_detail(session, kit)
            session.commit()
            return result

    def _history(
        self, session: Session, kind: str, identifier: UUID
    ) -> list[dict[str, object]]:
        column = (
            CatalogHistory.product_id if kind == "products" else CatalogHistory.kit_id
        )
        history = session.scalars(
            select(CatalogHistory)
            .where(column == identifier)
            .order_by(CatalogHistory.created_at.desc(), CatalogHistory.id)
        ).all()
        return [
            {
                "id": str(row.id),
                "actor_id": str(row.actor_id),
                "session_id": str(row.session_id),
                "operation": row.operation,
                "reason": row.reason,
                "snapshot": row.snapshot,
                "created_at": row.created_at.isoformat(),
            }
            for row in history
        ]

    def _product_detail(self, session: Session, product: Product) -> dict[str, object]:
        result = product_snapshot(product)
        result["history"] = self._history(session, "products", product.id)
        movements = session.scalars(
            select(StockMovement)
            .where(StockMovement.product_id == product.id)
            .order_by(StockMovement.created_at.desc(), StockMovement.id)
        ).all()
        result["movements"] = [
            {
                "id": str(row.id),
                "actor_id": str(row.actor_id),
                "session_id": str(row.session_id),
                "operation": row.operation,
                "reason": row.reason,
                "quantity": row.quantity,
                "total_after": row.total_after,
                "maintenance_after": row.maintenance_after,
                "created_at": row.created_at.isoformat(),
            }
            for row in movements
        ]
        entries = session.scalars(
            select(MaintenanceEntry)
            .where(MaintenanceEntry.product_id == product.id)
            .order_by(MaintenanceEntry.created_at, MaintenanceEntry.id)
        ).all()
        result["maintenance"] = [
            {
                "id": str(row.id),
                "quantity": row.quantity,
                "released_quantity": row.released_quantity,
                "reason": row.reason,
            }
            for row in entries
        ]
        photos = self._photos(session, product.id)
        result["photos"] = [photo_snapshot(photo) for photo in photos]
        result["principal_photo_id"] = next(
            (str(photo.id) for photo in photos if photo.is_principal),
            str(photos[0].id) if photos else None,
        )
        return result

    def _kit_detail(self, session: Session, kit: Kit) -> dict[str, object]:
        result = self._kit_snapshot(session, kit)
        result["history"] = self._history(session, "kits", kit.id)
        photos = self._photos(session, kit.id, "kits")
        result["photos"] = [photo_snapshot(photo) for photo in photos]
        result["principal_photo_id"] = next(
            (str(photo.id) for photo in photos if photo.is_principal),
            str(photos[0].id) if photos else None,
        )
        return result

    def get(self, kind: str, identifier: UUID) -> dict[str, object]:
        with session_scope(self.factory) as session:
            record = session.get(Product if kind == "products" else Kit, identifier)
            if record is None:
                raise CatalogError(404, "Cadastro não encontrado.")
            assert isinstance(record, Product | Kit)
            return (
                self._product_detail(session, record)
                if isinstance(record, Product)
                else self._kit_detail(session, record)
            )

    def list_records(
        self, kind: str, search: str, page: int, page_size: int
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            model = Product if kind == "products" else Kit
            # Treat wildcard characters literally rather than as a query language.
            clause = model.name.icontains(search, autoescape=True)
            total = (
                session.scalar(select(func.count()).select_from(model).where(clause))
                or 0
            )
            rows = session.scalars(
                select(model)
                .where(clause)
                .order_by(model.name, model.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            assert all(isinstance(row, Product | Kit) for row in rows)
            items = [
                product_snapshot(row)
                if isinstance(row, Product)
                else self._kit_snapshot(session, cast(Kit, row))
                for row in rows
            ]
            # One metadata query for the page; image bytes stay on the private route.
            owner = (
                ProductPhoto.product_id if kind == "products" else ProductPhoto.kit_id
            )
            principal_photos: dict[str, str] = {}
            if rows:
                photos = session.execute(
                    select(owner, ProductPhoto.id)
                    .where(
                        owner.in_([UUID(str(item["id"])) for item in items]),
                        ProductPhoto.is_attached,
                    )
                    .order_by(
                        ProductPhoto.is_principal.desc(),
                        ProductPhoto.position,
                        ProductPhoto.id,
                    )
                )
                for owner_id, photo_id in photos:
                    principal_photos.setdefault(str(owner_id), str(photo_id))
            for item in items:
                item["principal_photo_id"] = principal_photos.get(str(item["id"]))
            return {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    def _photos(
        self, session: Session, identifier: UUID, kind: str = "products"
    ) -> list[ProductPhoto]:
        owner = ProductPhoto.product_id if kind == "products" else ProductPhoto.kit_id
        return list(
            session.scalars(
                select(ProductPhoto)
                .where(owner == identifier, ProductPhoto.is_attached)
                .order_by(ProductPhoto.position, ProductPhoto.id)
            ).all()
        )

    def upload_photo(
        self,
        identifier: UUID,
        expected_version: int,
        data: bytes,
        content_type: str | None,
        actor: Identity,
        kind: str = "products",
    ) -> dict[str, object]:
        with active_operation():
            return self._upload_photo(
                identifier, expected_version, data, content_type, actor, kind
            )

    def _upload_photo(
        self,
        identifier: UUID,
        expected_version: int,
        data: bytes,
        content_type: str | None,
        actor: Identity,
        kind: str = "products",
    ) -> dict[str, object]:
        # Decode and write outside DB transaction. Only our new file is compensable.
        self.storage.checked_root()
        normalized, image_format = normalize_image(data, content_type)
        stored = self.storage.write(normalized, image_format)
        committed = False
        try:
            with session_scope(self.factory) as session:
                product = self._locked(
                    session,
                    Product if kind == "products" else Kit,
                    identifier,
                    expected_version,
                )
                photos = self._photos(session, identifier, kind)
                photo = ProductPhoto(
                    product_id=identifier if kind == "products" else None,
                    kit_id=identifier if kind == "kits" else None,
                    storage_key=stored.key,
                    format=stored.image_format,
                    size=stored.size,
                    sha256=stored.sha256,
                    position=max((p.position for p in photos), default=-1) + 1,
                    is_principal=not photos,
                    created_by=actor.user_id,
                )
                session.add(photo)
                self._touch(product, actor)
                session.flush()
                self._audit(
                    session,
                    product,
                    actor,
                    "photo_added",
                    "Foto adicionada",
                    photo_snapshot(photo),
                )
                session.flush()
                result = (
                    self._product_detail(session, product)
                    if isinstance(product, Product)
                    else self._kit_detail(session, product)
                )
                session.commit()
                committed = True
                return result
        except BaseException:
            if not committed:
                # A lost connection during COMMIT can leave its outcome unknown.
                # Delete only when a fresh transaction proves no metadata exists.
                try:
                    with session_scope(self.factory) as check:
                        absent = (
                            check.scalar(
                                select(ProductPhoto.id).where(
                                    ProductPhoto.storage_key == stored.key
                                )
                            )
                            is None
                        )
                    if absent:
                        self.storage.compensate(stored.key)
                except SQLAlchemyError:
                    pass
            raise

    def edit_photo(
        self,
        identifier: UUID,
        photo_id: UUID,
        payload: PhotoEdit | ReasonCommand,
        actor: Identity,
        kind: str = "products",
    ) -> dict[str, object]:
        with session_scope(self.factory) as session:
            product = self._locked(
                session,
                Product if kind == "products" else Kit,
                identifier,
                payload.expected_version,
            )
            photo = session.get(ProductPhoto, photo_id)
            owner_id = (
                None
                if photo is None
                else (photo.product_id if kind == "products" else photo.kit_id)
            )
            if photo is None or owner_id != identifier or not photo.is_attached:
                raise CatalogError(404, "Foto não encontrada nesta galeria.")
            if isinstance(payload, PhotoEdit):
                if payload.is_principal:
                    session.execute(
                        update(ProductPhoto)
                        .where(
                            (
                                ProductPhoto.product_id
                                if kind == "products"
                                else ProductPhoto.kit_id
                            )
                            == identifier,
                            ProductPhoto.is_attached,
                        )
                        .values(is_principal=False)
                    )
                    session.flush()
                elif photo.is_principal:
                    raise CatalogError(
                        422, "Escolha outra foto como principal primeiro."
                    )
                photo.position = payload.order
                photo.is_principal = payload.is_principal
                reason, operation = "Ordem e foto principal", "photo_edited"
            else:
                photo.is_attached = False
                was_principal = photo.is_principal
                photo.is_principal = False
                session.flush()
                remaining = self._photos(session, identifier, kind)
                if was_principal and remaining:
                    remaining[0].is_principal = True
                reason, operation = payload.reason, "photo_detached"
            self._touch(product, actor)
            self._audit(
                session, product, actor, operation, reason, photo_snapshot(photo)
            )
            if isinstance(product, Product):
                return self._commit_product(session, product)
            session.flush()
            result = self._kit_detail(session, product)
            session.commit()
            return result

    def read_photo(self, photo_id: UUID) -> tuple[bytes, str]:
        self.storage.checked_root()
        with session_scope(self.factory) as session:
            photo = session.get(ProductPhoto, photo_id)
            if photo is None:
                raise CatalogError(404, "Foto não encontrada.")
            key, size, digest, image_format = (
                photo.storage_key,
                photo.size,
                photo.sha256,
                photo.format,
            )
        return self.storage.read(key, size, digest), image_format
