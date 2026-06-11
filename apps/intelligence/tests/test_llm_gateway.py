import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from helio_intelligence.llm import (
    AssistantMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
    ToolSpec,
    UserMessage,
    create_llm_provider,
)
from helio_intelligence.llm.anthropic_provider import AnthropicProvider, _to_anthropic_messages
from helio_intelligence.llm.fake import FakeProvider
from helio_intelligence.llm.openai_compatible import (
    OpenAICompatibleProvider,
    _to_openai_message,
    _to_openai_tool,
)
from helio_intelligence.llm.types import LLMResponse
from helio_intelligence.settings import Settings


def _settings(**kwargs: Any) -> Settings:
    if "llm_api_key" in kwargs and isinstance(kwargs["llm_api_key"], str):
        kwargs["llm_api_key"] = SecretStr(kwargs["llm_api_key"])
    return Settings(**kwargs)


def test_openai_message_translation_roundtrips_roles() -> None:
    assert _to_openai_message(SystemMessage("be brief")) == {
        "role": "system",
        "content": "be brief",
    }
    assert _to_openai_message(UserMessage("hi")) == {"role": "user", "content": "hi"}
    assert _to_openai_message(ToolMessage(tool_call_id="t1", content="42")) == {
        "role": "tool",
        "tool_call_id": "t1",
        "content": "42",
    }
    assistant = _to_openai_message(
        AssistantMessage(
            content="", tool_calls=(ToolCall(id="t1", name="count", arguments={"q": "x"}),)
        )
    )
    assert assistant["role"] == "assistant"
    assert assistant["tool_calls"][0]["function"]["name"] == "count"
    assert json.loads(assistant["tool_calls"][0]["function"]["arguments"]) == {"q": "x"}


def test_openai_tool_translation() -> None:
    tool = ToolSpec(name="count", description="counts", parameters={"type": "object"})
    assert _to_openai_tool(tool) == {
        "type": "function",
        "function": {"name": "count", "description": "counts", "parameters": {"type": "object"}},
    }


def test_anthropic_splits_system_and_blocks_tool_io() -> None:
    system, converted = _to_anthropic_messages(
        [
            SystemMessage("sys-a"),
            SystemMessage("sys-b"),
            UserMessage("hello"),
            AssistantMessage(
                content="thinking",
                tool_calls=(ToolCall(id="t1", name="count", arguments={"q": "x"}),),
            ),
            ToolMessage(tool_call_id="t1", content="5"),
        ]
    )
    assert system == "sys-a\n\nsys-b"
    assert converted[0] == {"role": "user", "content": "hello"}
    assert converted[1]["content"][0] == {"type": "text", "text": "thinking"}
    assert converted[1]["content"][1]["type"] == "tool_use"
    assert converted[2]["content"][0]["type"] == "tool_result"
    assert converted[2]["content"][0]["tool_use_id"] == "t1"


async def test_fake_provider_replays_and_records() -> None:
    fake = FakeProvider([LLMResponse(text="first"), LLMResponse(text="second")])
    fake.enqueue(LLMResponse(text="third"))
    r1 = await fake.complete([UserMessage("a")], temperature=0.1)
    r2 = await fake.complete([UserMessage("b")])
    r3 = await fake.complete([UserMessage("c")])
    r4 = await fake.complete([UserMessage("d")])
    assert [r.text for r in (r1, r2, r3)] == ["first", "second", "third"]
    assert r4.text == ""
    assert len(fake.calls) == 4
    assert fake.calls[0]["temperature"] == 0.1


async def test_openai_provider_parses_text_and_tool_calls() -> None:
    tool_call = MagicMock()
    tool_call.id = "call_1"
    tool_call.function.name = "count_contacts"
    tool_call.function.arguments = json.dumps({"segment": "pro"})
    message = MagicMock(content="hi there", tool_calls=[tool_call])
    completion = MagicMock(
        choices=[MagicMock(message=message, finish_reason="tool_calls")],
        usage=MagicMock(prompt_tokens=11, completion_tokens=3),
    )
    with patch("helio_intelligence.llm.openai_compatible.AsyncOpenAI") as client_cls:
        client_cls.return_value.chat.completions.create = AsyncMock(return_value=completion)
        provider = OpenAICompatibleProvider(api_key="k", model="m", name="groq")
        response = await provider.complete(
            [UserMessage("how many?")],
            tools=[ToolSpec(name="count_contacts", description="d", parameters={})],
            temperature=0.3,
            max_tokens=128,
        )
    assert response.text == "hi there"
    assert response.wants_tools
    assert response.tool_calls[0].name == "count_contacts"
    assert response.tool_calls[0].arguments == {"segment": "pro"}
    assert response.usage.prompt_tokens == 11


async def test_openai_provider_tolerates_bad_tool_json() -> None:
    bad = MagicMock()
    bad.id = "c"
    bad.function.name = "x"
    bad.function.arguments = "{not json"
    completion = MagicMock(
        choices=[MagicMock(message=MagicMock(content=None, tool_calls=[bad]), finish_reason="x")],
        usage=MagicMock(prompt_tokens=0, completion_tokens=0),
    )
    with patch("helio_intelligence.llm.openai_compatible.AsyncOpenAI") as client_cls:
        client_cls.return_value.chat.completions.create = AsyncMock(return_value=completion)
        provider = OpenAICompatibleProvider(api_key="k", model="m")
        response = await provider.complete([UserMessage("x")])
    assert response.text == ""
    assert response.tool_calls[0].arguments == {}


async def test_anthropic_provider_parses_blocks() -> None:
    text_block = MagicMock(type="text", text="sure")
    tool_block = MagicMock(type="tool_use", id="tu_1", input={"plan": "pro"})
    tool_block.name = "build_segment"  # MagicMock(name=...) is reserved
    response = MagicMock(
        content=[text_block, tool_block],
        stop_reason="tool_use",
        usage=MagicMock(input_tokens=7, output_tokens=2),
    )
    with patch("helio_intelligence.llm.anthropic_provider.AsyncAnthropic") as client_cls:
        client_cls.return_value.messages.create = AsyncMock(return_value=response)
        provider = AnthropicProvider(api_key="k", model="claude-x")
        result = await provider.complete(
            [SystemMessage("sys"), UserMessage("hi")],
            tools=[ToolSpec(name="build_segment", description="d", parameters={})],
        )
    assert result.text == "sure"
    assert result.tool_calls[0].name == "build_segment"
    assert result.tool_calls[0].arguments == {"plan": "pro"}
    assert result.usage.completion_tokens == 2


def test_factory_selects_groq_with_default_base_url() -> None:
    provider = create_llm_provider(
        _settings(llm_provider="groq", llm_api_key="test-key", llm_model="llama-3.3-70b")
    )
    assert provider.name == "groq"
    assert provider.model == "llama-3.3-70b"


def test_factory_selects_anthropic() -> None:
    provider = create_llm_provider(
        _settings(llm_provider="anthropic", llm_api_key="test-key", llm_model="claude-x")
    )
    assert provider.name == "anthropic"


def test_factory_supports_local_llms_without_a_key() -> None:
    # Self-hosted: no key required, defaults to the Ollama endpoint.
    provider = create_llm_provider(_settings(llm_provider="ollama", llm_model="llama3"))
    assert provider.name == "ollama"


def test_factory_requires_a_key_for_hosted_providers() -> None:
    with pytest.raises(ValueError, match="INTEL_LLM_API_KEY"):
        create_llm_provider(_settings(llm_provider="openai", llm_api_key=""))


def test_factory_rejects_unknown_provider() -> None:
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        create_llm_provider(_settings(llm_provider="cohere", llm_api_key="k"))


def test_factory_refuses_plaintext_http_to_remote() -> None:
    with pytest.raises(ValueError, match="plaintext HTTP"):
        create_llm_provider(
            _settings(
                llm_provider="openai",
                llm_api_key="k",
                llm_base_url="http://evil.example.com/v1",
            )
        )


def test_factory_allows_plaintext_to_localhost() -> None:
    provider = create_llm_provider(
        _settings(
            llm_provider="local",
            llm_model="llama3",
            llm_base_url="http://localhost:8080/v1",
        )
    )
    assert provider.name == "local"


def test_factory_tls_override_allows_remote_http() -> None:
    provider = create_llm_provider(
        _settings(
            llm_provider="openai",
            llm_api_key="k",
            llm_base_url="http://internal.lan/v1",
            llm_require_tls=False,
        )
    )
    assert provider.name == "openai"


def test_secret_key_is_not_exposed_in_repr() -> None:
    settings = _settings(llm_provider="groq", llm_api_key="super-secret-value")
    assert "super-secret-value" not in repr(settings)
    assert "super-secret-value" not in str(settings)
    assert settings.llm_configured is True
