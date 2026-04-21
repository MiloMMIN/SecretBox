from pathlib import Path
import re
import unittest


WELCOME_PAGE_PATH = Path(__file__).resolve().parents[1] / 'pages' / 'welcome' / 'index.wxml'


def get_button_disabled_expression(button_class):
    content = WELCOME_PAGE_PATH.read_text(encoding='utf-8')
    pattern = re.compile(
        rf'<button\s+[^>]*class="{button_class}"[^>]*disabled="{{{{([^}}]+)}}}}"',
        re.MULTILINE,
    )
    match = pattern.search(content)
    assert match is not None, f'未找到 {button_class} 按钮的 disabled 绑定'
    return match.group(1)


class WelcomePageBindingsTest(unittest.TestCase):
    def test_enter_button_not_disabled_by_login_state(self):
        disabled_expression = get_button_disabled_expression('enter-button')

        self.assertNotIn('!isLoggedIn', disabled_expression)
        self.assertIn('entering', disabled_expression)
        self.assertIn('checkingLogin', disabled_expression)
        self.assertIn('loginLoading', disabled_expression)

    def test_reserve_button_not_disabled_by_login_state(self):
        disabled_expression = get_button_disabled_expression('reserve-button')

        self.assertNotIn('!isLoggedIn', disabled_expression)
        self.assertIn('entering', disabled_expression)
        self.assertIn('checkingLogin', disabled_expression)
        self.assertIn('loginLoading', disabled_expression)