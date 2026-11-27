"""CoS-only refresh validates inputs and never creates Manager Telegram state."""

import os
import shutil
import subprocess

from fixtures import ConfigFixture


class RefreshTelegramTests(ConfigFixture):
    def test_refresh_accepts_dev_prod_and_custom_environment_files(self):
        self.write_env("custom.env", 301)
        for filename, bot_id in ((".env", 101), (".env.prod", 201), ("custom.env", 301)):
            with self.subTest(filename=filename):
                result = self.refresh(filename)
                self.assertEqual(result.returncode, 0, result.stderr)
                profile = self.config("cos")["profiles"]["default"]
                self.assertEqual(profile["botId"], bot_id)
                self.assertEqual(profile["allowedUserId"], 123)
                self.assertFalse(self.config_path("manager").exists())
                self.assertNotIn("secret", result.stdout + result.stderr)

    def test_unchanged_refresh_does_not_rewrite_configuration(self):
        self.assertEqual(self.refresh().returncode, 0)
        before = self.config_path("cos").stat().st_mtime_ns
        self.assertEqual(self.refresh().returncode, 0)
        self.assertEqual(self.config_path("cos").stat().st_mtime_ns, before)

    def test_invalid_inputs_leave_configuration_untouched(self):
        path = self.root / ".env"
        original = path.read_text()
        for old, new in (("101:cos-secret", "invalid"), ("USER_ID=123", "USER_ID=0"), ("new_cos_bot", "invalid-name")):
            with self.subTest(setting=old):
                before = self.config_path("cos").read_bytes()
                path.write_text(original.replace(old, new))
                result = self.refresh()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.config_path("cos").read_bytes(), before)
                self.assertFalse(self.config_path("manager").exists())

    def test_refresh_requires_only_cos_telegram_values(self):
        (self.root / ".env").write_text("COS_TELEGRAM_TOKEN=601:private\nTELEGRAM_ALLOWED_USER_ID=123\n")
        result = self.refresh()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.config("cos")["profiles"]["default"]["botId"], 601)

    def test_make_defaults_to_dev_and_accepts_file_arguments(self):
        self.write_env("custom file.env", 501)
        for args, expected_id in (([], 101), (["ENV_FILE=.env.prod"], 201), (["ENV_FILE=custom file.env"], 501)):
            with self.subTest(args=args):
                result = subprocess.run([shutil.which("make"), "refresh-telegram", *args], cwd=self.root, capture_output=True, text=True, env=dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}"))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.config("cos")["profiles"]["default"]["botId"], expected_id)
