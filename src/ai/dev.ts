import { config } from 'dotenv';
config();

import '@/ai/flows/synthesize-advice-action-plan.ts';
import '@/ai/flows/analyze-user-situation.ts';
import '@/ai/flows/simulate-advisor-advice.ts';
import '@/ai/flows/recommend-virtual-advisors.ts';