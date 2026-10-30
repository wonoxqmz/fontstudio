"""字形工坊 — Windows 桌面版入口（pywebview 薄壳，加载与网页版同一套内核）"""
import os
import sys

import webview


def resource_path(rel: str) -> str:
    """兼容 PyInstaller 打包后的资源路径"""
    base = getattr(sys, '_MEIPASS', None)
    if base:
        return os.path.join(base, rel)
    # 开发时：desktop/main.py → 项目根
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', rel)


def main():
    index = resource_path('index.html')
    webview.create_window(
        '字形工坊',
        index,
        width=1440,
        height=920,
        min_size=(1100, 700),
        background_color='#f3f5f8',
    )
    webview.start()


if __name__ == '__main__':
    main()
