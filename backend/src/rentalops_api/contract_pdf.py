"""Deterministic v0.4 composition from frozen inputs, without business writes."""

import base64
import io
from datetime import datetime
from html import escape
from typing import Any, cast
from zoneinfo import ZoneInfo

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

INK = colors.HexColor("#203b38")
PALE = colors.HexColor("#edf3ef")
MUTED = colors.HexColor("#516760")


def address_text(address: Address) -> str:
    return ", ".join(str(value) for value in address.model_dump().values() if value)


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

    if snapshot.logo:
        story.extend([image(snapshot.logo, 160, 65), Spacer(1, 14)])
    story.extend(
        [
            paragraph(
                snapshot.company.name or "Locadora - preencher", "SectionContract"
            ),
            paragraph("Contrato de locação de coisas móveis", "TitleContract"),
            paragraph(
                f"Pegue e Monte | Versão {snapshot.number} | "
                f"{datetime.fromisoformat(snapshot.issued_at).astimezone(ZoneInfo('America/Sao_Paulo')).date().isoformat()}"
            ),
            field(
                "LOCADOR - IDENTIFICAÇÃO / CONTATO",
                " | ".join(
                    value
                    for value in [
                        snapshot.company.identification,
                        snapshot.company.contact,
                    ]
                    if value
                ),
            ),
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
            field("EVENTO", snapshot.event_date),
            field(
                "RETIRADA PREVISTA / JANELA DE HORÁRIO",
                f"{snapshot.pickup_date} | "
                f"{snapshot.pickup_time or 'Horário: a preencher'}",
            ),
            field(
                "DEVOLUÇÃO PREVISTA / JANELA DE HORÁRIO",
                f"{snapshot.return_date} | "
                f"{snapshot.return_time or 'Horário: a preencher'}",
            ),
            paragraph("Pagamento", "SectionContract"),
            field(
                "VALORES DO ACORDO REGISTRADO",
                f"Total R$ {snapshot.total} | Entrada R$ {snapshot.deposit} | "
                f"Restante R$ {snapshot.balance}",
            ),
            field(
                "CONFERÊNCIA FINANCEIRA NA EMISSÃO",
                f"Recebido líquido R$ {snapshot.received} | "
                f"Saldo a pagar R$ {snapshot.remaining}",
            ),
            field("FORMA ACORDADA / CARTÃO: NÚMERO DE PARCELAS (SE APLICÁVEL)", None),
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
    lines = cast(list[dict[str, object]], snapshot.commercial.get("lines", []))
    if lines:
        story.append(paragraph("Composição acordada", "SectionContract"))
        for line in lines:
            story.append(
                paragraph(
                    f"{line['quantity']} × {line['name']} | "
                    f"Valor unitário por locação R$ {line['unit_price']}"
                )
            )
            for component in cast(list[dict[str, object]], line["items"]):
                quantity = int(str(component["quantity"])) * int(str(line["quantity"]))
                story.append(paragraph(f"Inclui {quantity} × {component['name']}"))
        story.append(paragraph("Relação fotográfica consolidada", "SectionContract"))
    for item in snapshot.items:
        content = [paragraph(f"{item.quantity} × {item.name}", "SectionContract")]
        if item.photo:
            content.append(image(item.photo, width - 24, 190))
        else:
            content.append(field("FOTO DO PRODUTO PENDENTE - RASCUNHO", None, 100))
        content.extend(
            [
                Spacer(1, 10),
                paragraph(
                    "Condição: "
                    f"{item.condition or 'Pendente - preencher antes da emissão final'}"
                ),
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
        story.append(
            paragraph(
                f"{item.quantity} × {item.name} | "
                f"{item.condition or 'Condição pendente'}"
            )
        )
    story.extend(
        [
            field("OBSERVAÇÕES / CONFERÊNCIA DOS MATERIAIS", None, 70),
            field("ASSINATURA DO LOCADOR (CNPJ)", None, 70),
            field("ASSINATURA DO LOCATÁRIO (CPF)", None, 70),
        ]
    )

    def page(canvas: Any, document: Any) -> None:
        # reportlab is untyped; the runtime objects are library-owned.
        canvas.saveState()
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        footer = f"Contrato v{snapshot.number} | {snapshot.company.name or 'Locadora'}"
        # The full company field stays above; this duplicate must leave room
        # for the page number even at the200-character company-name limit.
        available = A4[0] - 88 - 24
        if canvas.stringWidth(footer, "Helvetica", 8) > available:
            while canvas.stringWidth(footer + "...", "Helvetica", 8) > available:
                footer = footer[:-1]
            footer += "..."
        canvas.drawString(44, 27, footer)
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
        title="Contrato de locação de coisas móveis",
        author=snapshot.company.name or "",
        invariant=1,
        pageCompression=1,
    )
    document.build(story, onFirstPage=page, onLaterPages=page)
    return target.getvalue()
