import axios from 'axios';

async function testAICreation() {
  try {
    console.log('Testing AI player creation...');
    
    // Create a test room with AI players
    const roomResponse = await axios.post('http://localhost:5000/api/rooms', {
      name: 'AI Test Room',
      maxPlayers: 10,
      turnDuration: 45,
      victoryCondition: 'domination',
      mapMode: 'continents',
      aiPlayerCount: 3,
      aiDifficulty: 'normal'
    });
    
    const room = roomResponse.data;
    console.log('Created room:', room);
    
    // Wait a moment for room seeding
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if AI players were created
    const playersResponse = await axios.get(`http://localhost:5000/api/rooms/${room.id}/players`);
    const players = playersResponse.data;
    
    console.log('Players in room:');
    players.forEach(player => {
      console.log(`- ID: ${player.id}, Nation: ${player.nationId}, AI: ${player.isAI}, Difficulty: ${player.aiDifficulty}`);
    });
    
    const aiPlayers = players.filter(p => p.isAI);
    console.log(`\nAI Players created: ${aiPlayers.length} (expected: 3)`);
    
    if (aiPlayers.length === 3) {
      console.log('✅ AI player creation test PASSED');
    } else {
      console.log('❌ AI player creation test FAILED');
    }
    
  } catch (error) {
    console.error('Test failed:', error.response?.data || error.message);
  }
}

testAICreation();
