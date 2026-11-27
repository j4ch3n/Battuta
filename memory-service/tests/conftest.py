import pytest

from helpers import make_store


@pytest.fixture
def store(tmp_path):
    return make_store(tmp_path)
