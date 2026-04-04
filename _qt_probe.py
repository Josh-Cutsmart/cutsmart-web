from PySide6.QtWebEngineCore import QWebEnginePage
print([m for m in dir(QWebEnginePage) if 'pdf' in m.lower() or 'print' in m.lower()])
