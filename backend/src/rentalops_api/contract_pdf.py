"""Deterministic v0.4 composition from frozen inputs, without business writes."""

import base64
import io
from datetime import date
from decimal import Decimal
from html import escape
from typing import Any, cast

from reportlab.lib import colors  # type: ignore[import-untyped]
from reportlab.lib.enums import TA_CENTER  # type: ignore[import-untyped]
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import (  # type: ignore[import-untyped]
    ParagraphStyle,
    getSampleStyleSheet,
)
from reportlab.platypus import (  # type: ignore[import-untyped]
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from rentalops_api.contract_contracts import ContractSnapshot, ImageSnapshot
from rentalops_api.customer_contracts import Address

INK = colors.HexColor("#173653")
PALE = colors.HexColor("#eff7ff")
MUTED = colors.HexColor("#536779")


def address_text(address: Address) -> str:
    return ", ".join(str(value) for value in address.model_dump().values() if value)


def currency(value: str) -> str:
    return "R$ " + format(Decimal(value), ",.2f").translate(str.maketrans(",.", ".,"))


def render_separation_checklist(
    commercial: dict[str, object], preparation: dict[str, object] | None = None
) -> bytes:
    """Read-only preparation sheet from the persisted rental composition."""
    target = io.BytesIO()
    styles = getSampleStyleSheet()
    rows: dict[str, tuple[str, int]] = {}
    for line in cast(list[dict[str, object]], commercial["lines"]):
        for item in cast(list[dict[str, object]], line["items"]):
            key = str(item["product_id"])
            name, quantity = rows.get(key, (str(item["name"]), 0))
            rows[key] = (
                name,
                quantity + int(str(item["quantity"])) * int(str(line["quantity"])),
            )
    story: list[object] = [
        Paragraph("Checklist de separação", styles["Title"]),
        Paragraph(
            f"Retirada: {escape(str(commercial.get('pickup_date', '')))} | "
            f"Devolução: {escape(str(commercial.get('return_date', '')))}",
            styles["Normal"],
        ),
        Spacer(1, 20),
    ]
    checked = {
        str(item["id"])
        for item in cast(
            list[dict[str, object]], (preparation or {}).get("products", [])
        )
        if item["checked"]
    }
    entries = [
        (f"{quantity} × {name}", key in checked, False)
        for key, (name, quantity) in rows.items()
    ]
    extras = cast(list[dict[str, object]], (preparation or {}).get("extras", []))
    entries += [
        (str(item["label"]), bool(item["checked"]), index == 0)
        for index, item in enumerate(extras)
    ]
    for label, marked, first_extra in entries:
        if first_extra:
            story.extend(
                [
                    Spacer(1, 12),
                    Paragraph(
                        "Extras de preparação (sem cobrança)", styles["Heading2"]
                    ),
                    Paragraph(
                        "Acessórios operacionais, fora dos itens do contrato.",
                        styles["Normal"],
                    ),
                    Spacer(1, 12),
                ]
            )
        box = Table([["X" if marked else ""]], colWidths=[16], rowHeights=[16])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, INK)]))
        row = Table(
            [[box, Paragraph(escape(label), styles["BodyText"])]],
            colWidths=[30, A4[0] - 130],
        )
        row.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                ]
            )
        )
        story.append(row)
    SimpleDocTemplate(
        target,
        pagesize=A4,
        leftMargin=44,
        rightMargin=44,
        topMargin=44,
        bottomMargin=44,
        invariant=1,
    ).build(story)
    return target.getvalue()


def render_pdf(snapshot: ContractSnapshot, *, draft: bool) -> bytes:
    """Fixed metadata/IDs and explicit clock make snapshots byte-identical."""
    target = io.BytesIO()
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "Body",
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=INK,
            spaceAfter=9,
        )
    )
    styles.add(
        ParagraphStyle(
            "Label",
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=MUTED,
            spaceAfter=5,
        )
    )
    styles.add(
        ParagraphStyle(
            "TitleContract",
            fontName="Helvetica-Bold",
            fontSize=23,
            leading=28,
            textColor=INK,
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            "SectionContract",
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=19,
            textColor=INK,
            spaceBefore=12,
            spaceAfter=10,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle("CenterContract", parent=styles["Body"], alignment=TA_CENTER)
    )
    width = A4[0] - 100  # SimpleDocTemplate frame has 6pt padding per side.
    story: list[object] = []

    def paragraph(value: str, style: str = "Body") -> object:
        return Paragraph(escape(value).replace("\n", "<br/>"), styles[style])

    def field(label: str, value: str | None, height: int = 52) -> object:
        if not label.startswith("ASSINATURA"):
            row = Table(
                [
                    [
                        paragraph(f"{label}:", "Label"),
                        paragraph(value or "________________________________"),
                    ]
                ],
                colWidths=[145, width - 145],
                minRowHeights=[28],
            )
            row.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ]
                )
            )
            return row
        block = Table(
            [[paragraph(label, "Label")], [paragraph(value or " ")]],
            colWidths=[width],
            minRowHeights=[0, height if not value else 28],
        )
        block.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 1), (-1, -1), 0.6, colors.HexColor("#b3c5bb")),
                    ("BACKGROUND", (0, 1), (-1, -1), PALE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 1), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 1), (-1, -1), 10),
                ]
            )
        )
        return KeepTogether([block, Spacer(1, 10)])

    def image(asset: ImageSnapshot, max_width: float, max_height: float) -> object:
        rendered = Image(io.BytesIO(base64.b64decode(asset.content, validate=True)))
        scale = min(max_width / rendered.imageWidth, max_height / rendered.imageHeight)
        rendered.drawWidth = rendered.imageWidth * scale
        rendered.drawHeight = rendered.imageHeight * scale
        return rendered

    def checklist_item(name: str, quantity: int) -> object:
        box = Table([[""]], colWidths=[16], rowHeights=[16])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, INK)]))
        row = Table(
            [[box, paragraph(f"{quantity} × {name}")]], colWidths=[30, width - 30]
        )
        row.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            )
        )
        return row

    if snapshot.logo:
        story.extend([image(snapshot.logo, 160, 65), Spacer(1, 14)])
    story.extend(
        [
            paragraph("Contrato de locação de decorações", "TitleContract"),
            field("LOCADOR", snapshot.company.name),
            field("IDENTIFICAÇÃO", snapshot.company.identification),
            field("CONTATO", snapshot.company.contact),
            field("ENDEREÇO DA LOCADORA", address_text(snapshot.company.address)),
            field("LOCATÁRIO - NOME COMPLETO", snapshot.customer_name),
            field(
                "CPF / RG (OPCIONAL) / TELEFONE",
                " | ".join(
                    value
                    for value in [
                        snapshot.customer_cpf,
                        snapshot.customer_rg,
                        snapshot.customer_phone,
                    ]
                    if value
                ),
            ),
            field("ENDEREÇO DO LOCATÁRIO", address_text(snapshot.customer_address)),
            field("ENDEREÇO DO EVENTO", address_text(snapshot.event_address)),
        ]
    )
    story.extend(
        [
            paragraph("Evento e agenda", "SectionContract"),
            field(
                "EVENTO", date.fromisoformat(snapshot.event_date).strftime("%d/%m/%Y")
            ),
            field(
                "RETIRADA PREVISTA / JANELA DE HORÁRIO",
                f"{date.fromisoformat(snapshot.pickup_date).strftime('%d/%m/%Y')} | "
                f"{snapshot.pickup_time or 'Horário: a preencher'}",
            ),
            field(
                "DEVOLUÇÃO PREVISTA / JANELA DE HORÁRIO",
                f"{date.fromisoformat(snapshot.return_date).strftime('%d/%m/%Y')} | "
                f"{snapshot.return_time or 'Horário: a preencher'}",
            ),
            paragraph("Pagamento", "SectionContract"),
            field("TOTAL", currency(snapshot.total)),
            field(
                "ENTRADA PAGA",
                currency(str(snapshot.financial.get("applied_deposit", "0.00"))),
            ),
            field(
                "RESTANTE PAGO",
                currency(str(snapshot.financial.get("applied_balance", "0.00"))),
            ),
        ]
    )
    # Only the approved clauses and responsibility text enter the instrument.
    clauses = snapshot.template_text.split("## Cláusulas do contrato\n", 1)[1].split(
        "## Anexo I", 1
    )[0]
    story.append(PageBreak())
    for section in clauses.split("### ")[1:]:
        title, body = section.strip().split("\n", 1)
        number, heading = title.split(". ", 1)
        story.append(paragraph(f"Cláusula {number}ª - {heading}", "SectionContract"))
        story.extend(
            paragraph(text.strip()) for text in body.split("\n\n") if text.strip()
        )
    story.extend(
        [
            Spacer(1, 15),
            field("LOCAL E DATA", None),
            field("ASSINATURA DO LOCADOR / IDENTIFICAÇÃO", None, 70),
            field("ASSINATURA DO LOCATÁRIO / CPF", None, 70),
            PageBreak(),
            paragraph("Anexo I - Descrição do material entregue", "TitleContract"),
            paragraph(
                "Produtos efetivamente locados, incluindo componentes dos kits "
                "e itens avulsos."
            ),
        ]
    )
    story.append(paragraph("Checklist dos materiais", "SectionContract"))
    for item in snapshot.items:
        story.append(checklist_item(item.name, item.quantity))
    story.append(paragraph("Fotos dos materiais", "SectionContract"))
    for item in snapshot.items:
        content = [paragraph(f"{item.quantity} × {item.name}", "SectionContract")]
        if item.photo:
            content.append(image(item.photo, width - 24, 190))
        else:
            content.append(field("FOTO DO PRODUTO PENDENTE - RASCUNHO", None, 100))
        content.extend(
            [
                Spacer(1, 10),
                Spacer(1, 16),
            ]
        )
        story.append(KeepTogether(content))
    story.extend(
        [
            PageBreak(),
            paragraph("Anexo II - Termo de responsabilidade", "TitleContract"),
            field(
                "LOCATÁRIO / CPF / TELEFONE",
                " | ".join(
                    value
                    for value in [
                        snapshot.customer_name,
                        snapshot.customer_cpf,
                        snapshot.customer_phone,
                    ]
                    if value
                ),
            ),
            field("ENDEREÇO", address_text(snapshot.customer_address)),
            field(
                "RETIRADA / DEVOLUÇÃO",
                f"{snapshot.pickup_date} / {snapshot.return_date}",
            ),
        ]
    )
    term = snapshot.template_text.split("## Anexo II - Termo de responsabilidade\n", 1)[
        1
    ].split("## Registro de revisão", 1)[0]
    for text in term.split("\n\n"):
        if text.strip().startswith(("O LOCATÁRIO acima", "O valor para")):
            story.append(paragraph(text.strip()))
    story.append(paragraph("Relação de itens", "SectionContract"))
    for item in snapshot.items:
        story.append(checklist_item(item.name, item.quantity))
    story.extend(
        [
            field("ASSINATURA DO LOCADOR (CNPJ)", None, 70),
            field("ASSINATURA DO LOCATÁRIO (CPF)", None, 70),
        ]
    )

    def page(canvas: Any, document: Any) -> None:
        # reportlab is untyped; the runtime objects are library-owned.
        canvas.saveState()
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0] - 44, 27, str(document.page))
        if draft:
            canvas.setFillColor(colors.HexColor("#8a3b22"))
            canvas.drawCentredString(
                A4[0] / 2, A4[1] - 25, "RASCUNHO - NÃO EMITIDO / NÃO ASSINADO"
            )
        canvas.restoreState()

    document = SimpleDocTemplate(
        target,
        pagesize=A4,
        rightMargin=44,
        leftMargin=44,
        topMargin=45,
        bottomMargin=45,
        title="Contrato de locação de decorações",
        author=snapshot.company.name or "",
        invariant=1,
        pageCompression=1,
    )
    document.build(story, onFirstPage=page, onLaterPages=page)
    return target.getvalue()
