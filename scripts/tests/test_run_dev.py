"""Launcher orchestration, independent of Telegram refresh implementation."""

from fixtures import LauncherFixture


class RunDevTests(LauncherFixture):
    def test_launch_does_not_refresh_telegram_configuration(self):
        for mode in ("dev", "prod"):
            for existing in (True, False):
                with self.subTest(mode=mode, existing=existing):
                    before = {role: self.config_path(role).read_text() for role in ("pm", "tl")}
                    result = self.run_launcher(mode, existing=existing)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    for role in ("pm", "tl"):
                        self.assertEqual(self.config_path(role).read_text(), before[role])
                    self.assertFalse(self.respawn_targets())

    def test_fresh_launch_uses_selected_environment_and_expected_panes(self):
        for mode, expected_splits in (("dev", 2), ("prod", 1)):
            with self.subTest(mode=mode):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_launcher(mode, existing=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                splits = [c for c in self.commands() if c[0] == "split-window"]
                self.assertEqual(len(splits), expected_splits)
                selected = self.root / (".env" if mode == "dev" else ".env.prod")
                for command in self.commands():
                    if "AGENT_ROLE=" in command[-1]:
                        self.assertIn(str(selected), command[-1].replace("\\ ", " "))
                self.assertEqual(self.commands()[-1], ["attach-session", "-t", f"=battuta-{mode}"])

    def test_existing_session_only_attaches(self):
        for mode in ("dev", "prod"):
            with self.subTest(mode=mode):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_launcher(mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.commands(), [
                    ["has-session", "-t", f"=battuta-{mode}"],
                    ["attach-session", "-t", f"=battuta-{mode}"],
                ])
