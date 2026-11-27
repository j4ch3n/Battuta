"""Release-install helpers shared by the opt-in integration run; stdlib only."""


def tool_environment(env, work, name):
    return {
        **env,
        "UV_TOOL_DIR": str(work / "tools" / name),
        "UV_TOOL_BIN_DIR": str(work / "bin" / name),
    }
