"""TODO failure identifiers and user-facing explanations."""

from enum import StrEnum


class TodoErrorCode(StrEnum):
    INVALID_INPUT = "INVALID_INPUT"
    CONFLICTING_FILTERS = "CONFLICTING_FILTERS"
    INVALID_ROLE = "INVALID_ROLE"
    PROJECT_UNAVAILABLE = "PROJECT_UNAVAILABLE"
    NO_TODO_LIST = "NO_TODO_LIST"
    NO_NEXT_TODO = "NO_NEXT_TODO"
    UNFINISHED_TODO = "UNFINISHED_TODO"
    INVALID_TODO_FILE = "INVALID_TODO_FILE"
    WORK_ID_COLLISION = "WORK_ID_COLLISION"
    NO_CURRENT_WORK = "NO_CURRENT_WORK"
    INVALID_REFERENCE = "INVALID_REFERENCE"
    TODO_STORAGE_ERROR = "TODO_STORAGE_ERROR"


TODO_ERROR_MESSAGES: dict[TodoErrorCode, str] = {
    TodoErrorCode.CONFLICTING_FILTERS: (
        "Choose either --next to show the next step or --remain to show all remaining steps, "
        "not both. Omit both flags to see the full list with rational explanations."
    ),
    TodoErrorCode.INVALID_INPUT: (
        "Choose --scope project or --scope general and supply nonblank --item descriptions in execution order. "
        "Use done or cancel to advance, supplying --rational with a detailed nonblank explanation of "
        "the outcome/verification or why the next item is cancelled."
    ),
    TodoErrorCode.INVALID_ROLE: (
        "Set AGENT_ROLE to pm or tl so the CLI can select the intended bot's TODO list, then retry the command."
    ),
    TodoErrorCode.PROJECT_UNAVAILABLE: (
        "Cannot use the selected project: {detail}. Select the intended registered project first, "
        "or use general scope if the work has no clear project ownership."
    ),
    TodoErrorCode.NO_TODO_LIST: (
        "No active list. Use create --item to start one in execution order before attempting a mutation."
    ),
    TodoErrorCode.NO_NEXT_TODO: (
        "No remaining TODO items. Create a new list for new work; the finished list has not been changed."
    ),
    TodoErrorCode.UNFINISHED_TODO: (
        "A new list was not created; {filename} is unchanged.\nRemaining:\n{remaining}\n"
        "Ask the human owner whether to resume/revise this list or abandon it. "
        "Pause the new work until they decide. Use create --force only after explicit owner approval to abandon it."
    ),
    TodoErrorCode.INVALID_TODO_FILE: (
        "Cannot read the TODO file {path}: {detail}. Fix this file before continuing; "
        "do not bypass it with force or fall back to older history."
    ),
    TodoErrorCode.WORK_ID_COLLISION: (
        "Cannot allocate an unused work ID. Existing work metadata and files were preserved; "
        "inspect storage for collisions and retry creation without deleting history."
    ),
    TodoErrorCode.NO_CURRENT_WORK: (
        "This role has no current work ID in this scope. Use create --item to start its own work; "
        "extend cannot initialize work or append to a legacy timestamped list."
    ),
    TodoErrorCode.INVALID_REFERENCE: (
        "Supply --related-to as pm:<work-id> or tl:<work-id>, using a five-character lowercase alphanumeric ID "
        "recorded in this project/general scope. Include ownership context in the bot-mail handoff."
    ),
    TodoErrorCode.TODO_STORAGE_ERROR: (
        "Cannot safely access TODO storage: {detail}. Check permissions and ensure managed paths are real "
        "directories and regular files, not symlinks. Fix the storage problem, then read the list before retrying."
    ),
}


class TodoError(Exception):
    def __init__(self, code: TodoErrorCode, **context: object):
        self.code = code
        self.message = TODO_ERROR_MESSAGES[code].format(**context)
        super().__init__(f"{code}: {self.message}")
