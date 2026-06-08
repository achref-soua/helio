"""A Pydantic mirror of @helio/core's email document schema.

In lock-step with packages/core/src/email-doc.ts so a generated email is
accepted verbatim by the TypeScript template API. Personalization tokens
like {{firstName|there}} are preserved as plain text.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import AnyHttpUrl, BaseModel, Field, TypeAdapter, field_validator

# The TS schema stores the url as a *plain* trimmed string (max 2048), not a
# normalized URL object — so we validate the shape but keep the raw string,
# byte-identical to what the template API expects.
_URL_CHECK = TypeAdapter(AnyHttpUrl)


def _validated_url(value: str) -> str:
    trimmed = value.strip()
    if len(trimmed) > 2048:
        raise ValueError("url exceeds 2048 characters")
    _URL_CHECK.validate_python(trimmed)
    return trimmed


class HeadingBlock(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["heading"] = "heading"
    text: str = Field(max_length=5000)


class ParagraphBlock(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["paragraph"] = "paragraph"
    text: str = Field(max_length=5000)


class ButtonBlock(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["button"] = "button"
    label: str = Field(min_length=1, max_length=200)
    url: str

    _check_url = field_validator("url")(staticmethod(_validated_url))


class ImageBlock(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["image"] = "image"
    url: str
    alt: str = Field(default="", max_length=300)

    _check_url = field_validator("url")(staticmethod(_validated_url))


class DividerBlock(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["divider"] = "divider"


class SpacerBlock(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    type: Literal["spacer"] = "spacer"


EmailBlock = Annotated[
    Union[  # noqa: UP007
        HeadingBlock,
        ParagraphBlock,
        ButtonBlock,
        ImageBlock,
        DividerBlock,
        SpacerBlock,
    ],
    Field(discriminator="type"),
]


class EmailDocument(BaseModel):
    blocks: list[EmailBlock] = Field(min_length=1, max_length=100)


def validate_email_document(data: dict[str, object]) -> EmailDocument:
    """Parse and bound-check an email document."""
    return EmailDocument.model_validate(data)
