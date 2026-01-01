@echo off
echo Testing AI player creation with authentication...

echo Step 1: Register test user...
curl -X POST http://localhost:5000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"testuser\",\"password\":\"testpass123\"}" ^
  -s -c cookies.txt

echo.
echo Step 2: Login test user...
curl -X POST http://localhost:5000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"testuser\",\"password\":\"testpass123\"}" ^
  -s -b cookies.txt -c cookies.txt

echo.
echo Step 3: Create test room with 3 AI players...
curl -X POST http://localhost:5000/api/rooms ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"AI Test Room\",\"maxPlayers\":10,\"turnDuration\":45,\"victoryCondition\":\"domination\",\"mapMode\":\"continents\",\"aiPlayerCount\":3,\"aiDifficulty\":\"normal\"}" ^
  -s -b cookies.txt > room_response.json

echo Room created. Response:
type room_response.json

echo.
echo Step 4: Extract room ID and check players...
powershell -Command "(Get-Content room_response.json | ConvertFrom-Json).id" > room_id.txt

set /p roomId=<room_id.txt
echo Room ID: %roomId%

echo.
echo Waiting for room seeding...
timeout /t 3 /nobreak >nul

echo.
echo Step 5: Check players in room...
curl -X GET http://localhost:5000/api/rooms/%roomId%/players ^
  -s -b cookies.txt

echo.
echo.
echo Test completed. Look for players with "isAI": true in the response above.

del room_response.json
del room_id.txt
del cookies.txt
