"""Refresh command file selection and validation, independent of launching."""

import os
import shutil
import subprocess

from fixtures import ConfigFixture


class RefreshTelegramTests(ConfigFixture):
    def test_refresh_accepts_dev_prod_and_custom_environment_files(self):
        self.write_env("custom.env", 301, 302)
        for filename, pm, tl in ((".env", 101, 102), (".env.prod", 201, 202), ("custom.env", 301, 302)):
            with self.subTest(filename=filename):
                result = self.refresh(filename)
                self.assertEqual(result.returncode, 0, result.stderr)
                for role, bot_id in (("pm", pm), ("tl", tl)):
                    profile = self.config(role)["profiles"]["default"]
                    self.assertEqual(profile["botToken"], f"{bot_id}:{role}-secret")
                    self.assertEqual(profile["botId"], bot_id)
                    self.assertEqual(profile["allowedUserId"], 123)
                self.assertNotIn("secret", result.stdout + result.stderr)
                self.assertFalse(self.log.exists())

    def test_unchanged_refresh_does_not_rewrite_configs(self):
        self.assertEqual(self.refresh().returncode, 0)
        before = {role: self.config_path(role).stat().st_mtime_ns for role in ("pm", "tl")}
        result = self.refresh()
        self.assertEqual(result.returncode, 0, result.stderr)
        for role in ("pm", "tl"):
            self.assertEqual(self.config_path(role).stat().st_mtime_ns, before[role])

    def test_refresh_updates_only_changed_bot(self):
        self.assertEqual(self.refresh().returncode, 0)
        before_tl = self.config_path("tl").stat().st_mtime_ns
        self.write_env(".env", 401, 102)
        self.assertEqual(self.refresh().returncode, 0)
        self.assertEqual(self.config("pm")["profiles"]["default"]["botId"], 401)
        self.assertEqual(self.config_path("tl").stat().st_mtime_ns, before_tl)

    def test_invalid_settings_leave_both_configs_untouched(self):
        path = self.root / ".env"
        original = path.read_text()
        for old, new in (("102:tl-secret", "invalid"), ("101:pm-secret", ""),
                         ("USER_ID=123", "USER_ID=0"), ("new_pm_bot", "invalid-name")):
            with self.subTest(setting=old):
                before = {role: self.config_path(role).read_text() for role in ("pm", "tl")}
                path.write_text(original.replace(old, new))
                result = self.refresh()
                self.assertNotEqual(result.returncode, 0)
                for role in ("pm", "tl"):
                    self.assertEqual(self.config_path(role).read_text(), before[role])

    def test_inline_comments_are_not_written_into_telegram_settings(self):
        path = self.root / ".env"
        path.write_text(path.read_text().replace("pm-secret", "pm-secret # rotated")
                        .replace("USER_ID=123", "USER_ID=123 # owner"))
        result = self.refresh()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.config("pm")["profiles"]["default"]["botToken"], "101:pm-secret")
        self.assertEqual(self.config("pm")["profiles"]["default"]["allowedUserId"], 123)

    def test_refresh_requires_only_telegram_values(self):
        path = self.root / ".env"
        path.write_text("PM_TELEGRAM_TOKEN=601:pm-test\nTL_TELEGRAM_TOKEN=602:tl-test\nTELEGRAM_ALLOWED_USER_ID=123\n")
        result = self.refresh()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.config("pm")["profiles"]["default"]["botId"], 601)

    def test_make_refresh_defaults_to_dev_and_accepts_file_arguments(self):
        self.write_env("custom file.env", 501, 502)
        for args, expected_id in (([], 101), (["ENV_FILE=.env.prod"], 201), (["ENV_FILE=custom file.env"], 501)):
            with self.subTest(args=args):
                result = subprocess.run([shutil.which("make"), "refresh-telegram", *args],
                                        cwd=self.root, capture_output=True, text=True,
                                        env=dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}"))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.config("pm")["profiles"]["default"]["botId"], expected_id)
