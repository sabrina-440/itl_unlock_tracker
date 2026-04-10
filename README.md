# itl_unlock_tracker
ITL2026 unlock tracker bc I am lazy
https://itlunlocks.saberwing440.com/ 
## instructions
deploy:
docker build -t itl2026 -f /path/to/itl_unlock_tracker/Dockerfile /path/to/itl_unlock_tracker/
docker run -p 8000:8000 itl2026
