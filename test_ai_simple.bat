@echo off
echo Testing AI player creation...

echo Creating test room with 3 AI players...
curl -X POST http://localhost:5000/api/rooms ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"AI Test Room\",\"maxPlayers\":10,\"turnDuration\":45,\"victoryCondition\":\"domination\",\"mapMode\":\"continents\",\"aiPlayerCount\":3,\"aiDifficulty\":\"normal\"}" ^
  -s > room_response.json

echo Room created. Response:
type room_response.json

echo.
echo Waiting for room seeding...
timeout /t 3 /nobreak >nul

echo.
echo Checking players in room...
curl -X GET http://localhost:5000/api/rooms/1/players -s

echo.
echo Test completed. Manually check if AI players were created with isAI: true.

del room_response.json
