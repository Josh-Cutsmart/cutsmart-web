
Cutsmart Local UI Build
=======================

This keeps the UI structure and styling from the provided files, but swaps backend storage to local JSON files.

Run:
1. Create a virtual environment
2. pip install -r requirements.txt
3. .venv\Scripts\activate
4. python main.py

Local files are saved in:
- src/cutsmart/local_data/data.json
- src/cutsmart/local_data/session.json

Notes:
- Default invited staff accounts are created locally with password: password
- All data is local only, so this can be swapped for Firebase later
