"""Integration smoke test: does a real network round-trip work at all?

Run against a local simulator:

    .venv\\Scripts\\glsim.exe --port 4000 --validators 3 --no-browser
    gltest tests/integration -v -s --network localnet
"""

import json

from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded

AGENT = "0x" + "a1" * 20
MERCHANT = "0x" + "b2" * 20
PER_TX = 10**16
HOURLY = 5 * 10**16

APPROVE = json.dumps(
    {
        "decision": "approve",
        "risk_score": 12,
        "confidence": 95,
        "expected_value": "Rents inference capacity for a scheduled evaluation run.",
        "reasoning": "The merchant is allowlisted and the amount fits every limit.",
    }
)


def mocked_validators(count: int = 3):
    """A validator set whose LLM always returns the same verdict."""
    return [
        {
            "provider": "openai",
            "model": "gpt-4o",
            "config": {},
            "plugin": "openai-compatible",
            "plugin_config": {"mock_response": {"response": {".*": APPROVE}}},
        }
        for _ in range(count)
    ]


def test_deploy_and_read_config(default_account):
    factory = get_contract_factory("GuardianBudget")
    contract = factory.deploy(args=[AGENT, PER_TX, HOURLY])

    config = json.loads(contract.get_config(args=[]).call())
    print("\nCONFIG:", json.dumps(config, indent=2))

    assert config["authorizedAgent"].lower() == AGENT
    assert config["perTransactionLimit"] == str(PER_TX)
    assert config["hourlyLimit"] == str(HOURLY)
    assert config["paused"] is False
    assert config["requestCount"] == 0


def test_allowlist_round_trip():
    factory = get_contract_factory("GuardianBudget")
    contract = factory.deploy(args=[AGENT, PER_TX, HOURLY])

    assert contract.is_merchant_allowed(args=[MERCHANT]).call() is False

    receipt = contract.set_merchant_allowed(args=[MERCHANT, True]).transact()
    assert tx_execution_succeeded(receipt)

    assert contract.is_merchant_allowed(args=[MERCHANT]).call() is True


def test_treasury_balance_visibility():
    """Does the contract see a funded balance on this network?

    `self.balance` gates the whole approval path, so this is the pivotal
    capability check for any local simulator.
    """
    factory = get_contract_factory("GuardianBudget")
    contract = factory.deploy(args=[AGENT, PER_TX, HOURLY])

    receipt = contract.fund(args=[]).transact(value=10**18)
    print("\nFUND receipt status:", receipt.get("statusName"), receipt.get("txExecutionResultName"))

    config = json.loads(contract.get_config(args=[]).call())
    print("BALANCE seen by contract:", config["balance"])

    assert config["balance"] != "0", (
        "The contract reads its own balance as zero after funding. Every payment "
        "request will be rejected for insufficient balance, so this network cannot "
        "exercise the approval path."
    )
