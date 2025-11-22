import { promises as fs } from 'fs';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'db.json');

export type DbUser = {
  chatId: number;
  consultationsUsed: number;
  firstName: string;
  lastName: string;
  username: string;
};

type Database = {
  [chatId: number]: DbUser;
};

async function readDb(): Promise<Database> {
  try {
    await fs.access(dbPath);
    const data = await fs.readFile(dbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // If the file doesn't exist or is invalid, return an empty object
    return {};
  }
}

async function writeDb(data: Database): Promise<void> {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Retrieves a user from the database. If the user doesn't exist,
 * creates a new one with default values.
 * @param chatId The Telegram chat ID of the user.
 * @returns The user object.
 */
export async function getUser(chatId: number): Promise<DbUser> {
  const db = await readDb();
  if (db[chatId]) {
    return db[chatId];
  }

  // Create a new user if not found
  const newUser: DbUser = {
    chatId: chatId,
    consultationsUsed: 0,
    firstName: '',
    lastName: '',
    username: '',
  };

  db[chatId] = newUser;
  await writeDb(db);
  return newUser;
}

/**
 * Saves a user's data to the database.
 * @param user The user object to save.
 */
export async function saveUser(user: DbUser): Promise<void> {
  const db = await readDb();
  db[user.chatId] = user;
  await writeDb(db);
}