from abc import ABC


class BaseAgent(ABC):
    """Base class for workflow agents."""

    name: str
