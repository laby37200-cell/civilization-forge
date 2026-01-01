@echo off
echo Testing AI player creation...

echo Creating test room with 3 AI players...
curl -X POST http://localhost:5000/api/rooms ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"AI Test Room\",\"maxPlayers\":10,\"turnDuration\":45,\"victoryCondition\":\"domination\",\"mapMode\":\"continents\",\"aiPlayerCount\":3,\"aiDifficulty\":\"normal\"}" ^
  -s | jq ".id" > room_id.txt

set /p roomId=<room_id.txt
echo Created room ID: %roomId%

echo Waiting for room seeding...
timeout /t 3 /nobreak >nul

echo Checking players in room...
curl -X GET http://localhost:5000/api/rooms/%roomId%/players -s | jq ".[] | {id: .id, nationId: .nationId, isAI: .isAI, aiDifficulty: .aiDifficulty}"

echo.
echo Test completed. Check if AI players were created with isAI: true.

del room_id.txt
