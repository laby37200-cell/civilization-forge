import { db } from '../server/db.js';
import { gameRooms, gamePlayers } from '@shared/schema.js';
import { eq } from 'drizzle-orm';

async function testAICreation() {
  try {
    console.log('Testing AI player creation directly...');
    
    // Create a test room
    const [room] = await db.insert(gameRooms).values({
      name: 'AI Test Room Direct',
      hostId: 1,
      maxPlayers: 10,
      turnDuration: 45,
      victoryCondition: 'domination',
      mapMode: 'continents',
      aiPlayerCount: 3,
      aiDifficulty: 'normal',
    }).returning();

    console.log('Created test room:', room);

    // Import and call seedRoom function
    const routesModule = await import('../server/routes.js');
    const seedRoom = routesModule.seedRoom;
    
    if (!seedRoom) {
      console.error('seedRoom function not found in routes module');
      return;
    }
    
    await seedRoom(room.id);

    // Check if AI players were created
    const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, room.id));
    
    console.log('\nPlayers in room:');
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

    // Cleanup
    await db.delete(gamePlayers).where(eq(gamePlayers.gameId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
    console.log('\nTest data cleaned up');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testAICreation();
