import base64
import hashlib
import io
import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfReader

from rentalops_api.contract_contracts import (
    ContractIssue,
    ContractPreview,
    ContractSnapshot,
    DeliveryCommand,
    ImageSnapshot,
    ItemSnapshot,
    SignatureCommand,
)
from rentalops_api.contract_pdf import render_pdf
from rentalops_api.contracts import (
    TEMPLATE_DIGEST,
    TEMPLATE_REVISION,
    differences,
    template,
)


def image_bytes(vertical=False):
    output = io.BytesIO()
    Image.new("RGB", (90, 180) if vertical else (180, 90), "#527c68").save(
        output, format="PNG"
    )
    return output.getvalue()


def synthetic_cpf():
    # Generated only at runtime, never a real fixture identity.
    digits = [int(char, 16) % 10 for char in uuid4().hex[:9]]
    for size in (9, 10):
        digits.append(
            (sum(digits[index] * (size + 1 - index) for index in range(size)) * 10 % 11)
            % 10
        )
    return "".join(map(str, digits))


def snapshot(count=2, logo=False):
    image = image_bytes()
    asset = ImageSnapshot(
        id=uuid4(),
        sha256=hashlib.sha256(image).hexdigest(),
        content_type="image/png",
        content=base64.b64encode(image).decode(),
    )
    return ContractSnapshot(
        quotation_id=uuid4(),
        quotation_version=1,
        financial_version=0,
        rental_version=0,
        company_version=1,
        customer_version=1,
        template_revision=TEMPLATE_REVISION,
        template_digest=TEMPLATE_DIGEST,
        template_text=template(),
        number=1,
        issued_at=datetime(2026, 10, 10, 12, tzinfo=UTC).isoformat(),
        company={
            "name": "Locadora Sintética",
            "identification": "IDENTIFICAÇÃO SINTÉTICA",
            "address": {},
            "contact": "Contato sintético",
        },
        logo=asset if logo else None,
        customer_name="Cliente Sintético",
        customer_cpf=None,
        customer_rg=None,
        customer_phone="Contato sintético",
        customer_address={},
        event_address={},
        pickup_date="2026-10-10",
        event_date="2026-10-11",
        return_date="2026-10-13",
        pickup_time=None,
        return_time=None,
        total="400.00",
        deposit="200.00",
        balance="200.00",
        received="0.00",
        remaining="400.00",
        items=[
            ItemSnapshot(
                product_id=uuid4(),
                name=f"Produto sintético {index:02}",
                quantity=index + 1,
                condition="Bom estado, conferência sintética",
                photo=asset.model_copy(
                    update={
                        "content": base64.b64encode(
                            image_bytes(index % 2 == 0)
                        ).decode()
                    }
                ),
            )
            for index in range(count)
        ],
    )


def test_strict_commands_do_not_accept_money_replacement_or_actor():
    body = {
        "expected_quotation_version": 1,
        "expected_financial_version": 0,
        "expected_company_version": 0,
    }
    for field, value in {
        "actor_id": str(uuid4()),
        "total": "1.00",
        "replacement_value": "10.00",
        "template_revision": "draft",
        "expected_company_version": True,
    }.items():
        with pytest.raises(ValidationError):
            ContractPreview.model_validate({**body, field: value})
    with pytest.raises(ValidationError):
        ContractIssue.model_validate(body)
    pid = str(uuid4())
    with pytest.raises(ValidationError):
        ContractPreview.model_validate(
            {**body, "items": [{"product_id": pid}, {"product_id": pid}]}
        )


def test_ctr02_03_deterministic_nine_clauses_term_images_no_internal_notes():
    frozen = snapshot(30, logo=True)
    first = render_pdf(frozen, draft=False)
    assert first == render_pdf(frozen, draft=False)
    reader = PdfReader(io.BytesIO(first))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) >= 12
    for number in range(1, 10):
        assert f"Cláusula {number}ª" in text
    for item in frozen.items:
        # Material checklist, photo caption and delivery responsibility relation.
        assert text.count(item.name) == 3
    for phrase in (
        "nenhum valor será reembolsado",
        "seis meses",
        "30 (trinta) dias",
        "R$ 100,00",
        "número de parcelas",
        "VELAS FAÍSCA",
        "O LOCATÁRIO acima descrito",
        "O valor para um possível reembolso",
    ):
        assert phrase in text
    for phrase in (
        "RentalOps",
        "MINUTA",
        "RASCUNHO",
        "Registro de revisão",
        "revisão jurídica",
        "cola quente",
        "perfuração",
        "Valor de reposição (R$)",
    ):
        assert phrase not in text
    draft = render_pdf(frozen, draft=True)
    assert "RASCUNHO" in PdfReader(io.BytesIO(draft)).pages[0].extract_text()
    placements = []

    def placed(operator, operands, matrix, text_matrix):
        if operator == b"Do":
            placements.append(matrix[0] / matrix[3])

    for page in reader.pages:
        page.extract_text(visitor_operand_before=placed)
    # PDF resources deduplicate repeated pixels; count drawn occurrences instead.
    assert len(placements) == 31  # All30 products plus the optional logo.
    assert {round(value, 2) for value in placements} == {0.5, 2.0}


@pytest.mark.parametrize("name", ["Locadora Sintética", "W" * 200])
def test_removed_company_footer_keeps_full_company_field_and_page_numbers(
    monkeypatch, name
):
    from reportlab.pdfgen.canvas import Canvas

    frozen = snapshot()
    frozen.company.name = name
    footers = []
    original = Canvas.drawString

    def draw_string(canvas, x, y, text, *args, **kwargs):
        if x == 44 and y == 27:
            footers.append(text)
        return original(canvas, x, y, text, *args, **kwargs)

    monkeypatch.setattr(Canvas, "drawString", draw_string)
    content = render_pdf(frozen, draft=False)
    assert footers == []
    pages = PdfReader(io.BytesIO(content)).pages
    assert all(
        str(index) in page.extract_text().splitlines()
        for index, page in enumerate(pages, 1)
    )
    text = "".join(page.extract_text() for page in pages)
    assert "Contrato v1" not in text
    assert "".join(name.split()) in "".join(text.split())


def test_semantic_diff_uses_digests_not_private_image_bytes():
    old = snapshot().model_dump(mode="json")
    new = {**old, "number": 2, "issued_at": "later"}
    assert differences(old, new) == []
    new["company_version"] = 2
    assert differences(old, new) == [
        {"field": "company_version", "before": 1, "after": 2}
    ]
    changed = json.loads(json.dumps(old))
    changed["items"][0]["photo"]["storage_key"] = "private-opaque-key.png"
    changed["items"][0]["photo"]["content"] = "private-pixels"
    changed["items"][0]["photo"]["sha256"] = "changed-digest"
    diff = differences(old, changed)
    assert diff and "changed-digest" in json.dumps(diff)
    assert '"storage_key":' not in json.dumps(diff)
    assert '"content":' not in json.dumps(diff)
    assert "private-pixels" not in json.dumps(diff)


def test_event_commands_require_iso_dates_and_explicit_boolean_review():
    common = {"request_id": str(uuid4()), "expected_contract_version": 1}
    for value in (0, True, "10/10/2026", "2026-10-10T00:00:00Z"):
        with pytest.raises(ValidationError):
            DeliveryCommand.model_validate(
                {
                    **common,
                    "method": "in_person",
                    "reason": "Synthetic",
                    "business_date": value,
                }
            )
    with pytest.raises(ValidationError):
        SignatureCommand.model_validate({**common, "reviewed": "true"})


def test_document_hides_technical_issuance_header_and_preserves_audit_timestamp():
    frozen = snapshot().model_copy(update={"issued_at": "2026-10-11T00:30:00+00:00"})
    document = PdfReader(io.BytesIO(render_pdf(frozen, draft=False)))
    title = document.pages[0].extract_text()
    assert "Contrato de locação de decorações" in title
    assert "Pegue e Monte | Versão" not in title
    assert "LOCAL E DATA:" in "".join(page.extract_text() for page in document.pages)
    assert frozen.issued_at == "2026-10-11T00:30:00+00:00"
