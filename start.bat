@echo off
echo ======================================================================
echo Starting ResearchMate - Personal Literature Review Notebook
echo ======================================================================
echo Opening http://localhost:8000 in your default browser...
start http://localhost:8000
python -m http.server 8000
pause
