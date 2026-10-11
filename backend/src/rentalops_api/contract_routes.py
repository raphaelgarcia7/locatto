"""Session authenticated private contract/parameters HTTP boundaries."""

from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import ValidationError

from rentalops_api.auth_routes import CurrentIdentity, trusted_origin
from rentalops_api.catalog_storage import MAX_UPLOAD_BYTES
from rentalops_api.config import DatabaseSettings
from rentalops_api.contract_contracts import (
    CompanyCommand,
    CompanyView,
    ContractIssue,
    ContractPreview,
    ContractView,
    DeliveryCommand,
    LogoCommand,
    PreviewView,
    SignatureCommand,
    SignatureStateView,
    SignatureValidation,
)
from rentalops_api.contracts import ContractService
from rentalops_api.customer_routes import private_response
from rentalops_api.database import build_engine, build_session_factory
from rentalops_api.payment_errors import PaymentError, invalid
from rentalops_api.payment_storage import MAX_PROOF_BYTES

router = APIRouter(tags=["Contracts"], dependencies=[Depends(private_response)])
mutation = [Depends(trusted_origin)]


def contract_service() -> Iterator[ContractService]:
    engine = build_engine(DatabaseSettings.from_environment())
    try:
        yield ContractService(build_session_factory(engine))
    finally:
        engine.dispose()


Service = Annotated[ContractService, Depends(contract_service)]


@router.get("/parameters", response_model=CompanyView)
def parameters(identity: CurrentIdentity, service: Service) -> dict[str, object]:
    return service.company()


@router.post("/parameters", dependencies=mutation, response_model=CompanyView)
def update_parameters(
    payload: CompanyCommand, identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    return service.update_company(payload, identity)


async def strict_form(request: Request, allowed: set[str]) -> None:
    form = await request.form()
    if (
        request.query_params
        or set(form) != allowed
        or any(len(form.getlist(key)) != 1 for key in allowed)
    ):
        raise invalid("Campos inválidos no formulário de arquivo.")


@router.post("/parameters/logo", dependencies=mutation, response_model=CompanyView)
async def upload_logo(
    request: Request,
    identity: CurrentIdentity,
    service: Service,
    file: Annotated[UploadFile, File()],
    request_id: Annotated[UUID, Form()],
    expected_version: Annotated[int, Form(ge=0, le=2_147_483_647)],
) -> dict[str, object]:
    try:
        await strict_form(request, {"file", "request_id", "expected_version"})
        command = LogoCommand(request_id=request_id, expected_version=expected_version)
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        return service.update_company(command, identity, (data, file.content_type))
    finally:
        await file.close()


@router.post(
    "/parameters/logo/removal", dependencies=mutation, response_model=CompanyView
)
def remove_logo(
    payload: LogoCommand, identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    if not payload.remove:
        raise invalid("Confirme a remoção da logo.")
    return service.update_company(payload, identity)


def private_file(data: bytes, content_type: str, filename: str) -> Response:
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/parameters/logo")
def download_logo(identity: CurrentIdentity, service: Service) -> Response:
    data, content_type = service.company_logo()
    return private_file(data, content_type, "logo")


@router.post(
    "/quotations/{quotation_id}/contracts/preview",
    dependencies=mutation,
    response_model=PreviewView,
)
def preview(
    quotation_id: UUID,
    payload: ContractPreview,
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.preview(quotation_id, payload)


@router.post(
    "/quotations/{quotation_id}/contracts",
    dependencies=mutation,
    response_model=ContractView,
)
def issue(
    quotation_id: UUID,
    payload: ContractIssue,
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.issue(quotation_id, payload, identity)


@router.get("/quotations/{quotation_id}/contracts", response_model=list[ContractView])
def quotation_versions(
    quotation_id: UUID, identity: CurrentIdentity, service: Service
) -> list[dict[str, object]]:
    return service.versions(quotation_id, quotation=True)


@router.get(
    "/quotations/{quotation_id}/contracts/current-signature-state",
    response_model=SignatureStateView,
)
def quotation_signature_state(
    quotation_id: UUID, identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    return service.signature_state(quotation_id)


@router.get("/contracts/{identifier}/versions", response_model=list[ContractView])
def versions(
    identifier: UUID, identity: CurrentIdentity, service: Service
) -> list[dict[str, object]]:
    return service.versions(identifier)


@router.get("/contracts/{identifier}/versions/{number}", response_model=ContractView)
def version(
    identifier: UUID, number: int, identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    return service.version(identifier, number)


@router.get(
    "/contracts/{identifier}/current-signature-state", response_model=SignatureStateView
)
def signature_state(
    identifier: UUID, identity: CurrentIdentity, service: Service
) -> dict[str, object]:
    view = service.versions(identifier)[0]
    return service.signature_state(UUID(str(view["quotation_id"])))


@router.get("/contracts/{identifier}/versions/{number}/download")
def download(
    identifier: UUID, number: int, identity: CurrentIdentity, service: Service
) -> Response:
    return private_file(*service.download(identifier, number))


@router.get(
    "/contracts/{identifier}/versions/{number}/signatures/{attachment_id}/download"
)
def download_signature(
    identifier: UUID,
    number: int,
    attachment_id: UUID,
    identity: CurrentIdentity,
    service: Service,
) -> Response:
    return private_file(*service.download(identifier, number, attachment_id))


@router.post(
    "/contracts/{identifier}/versions/{number}/deliveries",
    dependencies=mutation,
    response_model=ContractView,
)
def delivery(
    identifier: UUID,
    number: int,
    payload: DeliveryCommand,
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.event(identifier, number, payload, identity)


@router.post(
    "/contracts/{identifier}/versions/{number}/signatures",
    dependencies=mutation,
    response_model=ContractView,
)
async def signature(
    request: Request,
    identifier: UUID,
    number: int,
    identity: CurrentIdentity,
    service: Service,
    file: Annotated[UploadFile, File()],
    request_id: Annotated[UUID, Form()],
    expected_contract_version: Annotated[int, Form(ge=1)],
    reviewed: Annotated[bool, Form()] = False,
    signed_date: Annotated[str, Form()] = "",
    declaration: Annotated[str, Form()] = "",
) -> dict[str, object]:
    try:
        await strict_form(
            request,
            {
                "file",
                "request_id",
                "expected_contract_version",
                "reviewed",
                "signed_date",
                "declaration",
            },
        )
        try:
            command = SignatureCommand.model_validate(
                {
                    "request_id": request_id,
                    "expected_contract_version": expected_contract_version,
                    "reviewed": reviewed,
                    "signed_date": signed_date or None,
                    "declaration": declaration or None,
                }
            )
        except ValidationError:
            raise invalid("Confira a data e os campos da assinatura.") from None
        data = await file.read(MAX_PROOF_BYTES + 1)
        if len(data) > MAX_PROOF_BYTES:
            raise PaymentError(
                413, "attachment_too_large", "Anexo excede 10.000.000 bytes."
            )
        return service.event(
            identifier, number, command, identity, (data, file.content_type)
        )
    finally:
        await file.close()


@router.post(
    "/contracts/{identifier}/versions/{number}/signatures/{attachment_id}/validations",
    dependencies=mutation,
    response_model=ContractView,
)
def validation(
    identifier: UUID,
    number: int,
    attachment_id: UUID,
    payload: SignatureValidation,
    identity: CurrentIdentity,
    service: Service,
) -> dict[str, object]:
    return service.event(
        identifier, number, payload, identity, attachment_id=attachment_id
    )
