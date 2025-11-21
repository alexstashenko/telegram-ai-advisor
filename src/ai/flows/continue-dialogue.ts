'use server';

/**
 * @fileOverview Continues a dialogue with the user, answering follow-up questions.
 *
 * - continueDialogue - A function that handles follow-up questions.
 * - ContinueDialogueInput - The input type for the continueDialogue function.
 * - ContinueDialogueOutput - The return type for the continueDialogue function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { advisorProfiles } from './simulate-advisor-advice';

const ContinueDialogueInputSchema = z.object({
  question: z.string().describe('The user\'s follow-up question.'),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).describe('The conversation history.'),
});

export type ContinueDialogueInput = z.infer<typeof ContinueDialogueInputSchema>;

const ContinueDialogueOutputSchema = z.object({
  answer: z.string().describe('The AI\'s response to the follow-up question.'),
});

export type ContinueDialogueOutput = z.infer<typeof ContinueDialogueOutputSchema>;

export async function continueDialogue(input: ContinueDialogueInput): Promise<ContinueDialogueOutput> {
  return continueDialogueFlow(input);
}

const continueDialoguePrompt = ai.definePrompt({
  name: 'continueDialoguePrompt',
  input: {schema: ContinueDialogueInputSchema},
  output: {schema: ContinueDialogueOutputSchema},
  prompt: `You are a facilitator of a personal advisory board. The user is asking a follow-up question. Your task is to provide an answer from the perspective of ONE specific advisor if they are mentioned by name. If no specific advisor is mentioned, provide a general answer from the facilitator's perspective.
Your response must be in Russian.

Advisor Profiles for reference:
Наваль Равикант (Naval Ravikant): Name: {{lookup ../advisorProfiles "NavalRavikant" "name"}}, Style: {{lookup ../advisorProfiles "NavalRavikant" "style"}}, Principles: {{lookup ../advisorProfiles "NavalRavikant" "principles"}}
Питер Левелс (Pieter Levels): Name: {{lookup ../advisorProfiles "PieterLevels" "name"}}, Style: {{lookup ../advisorProfiles "PieterLevels" "style"}}, Principles: {{lookup ../advisorProfiles "PieterLevels" "principles"}}
Гэри Вайнерчук (Gary Vaynerchuk): Name: {{lookup ../advisorProfiles "GaryVaynerchuk" "name"}}, Style: {{lookup ../advisorProfiles "GaryVaynerchuk" "style"}}, Principles: {{lookup ../advisorProfiles "GaryVaynerchuk" "principles"}}

Conversation History:
{{#each history}}
- {{role}}: {{content}}
{{/each}}

User's new question: {{question}}

INSTRUCTIONS:
1.  Analyze the "User's new question".
2.  Check if it contains a name of an advisor (e.g., "Наваль", "Питер", "Гэри").
3.  If a name is present, you MUST answer ONLY from that advisor's perspective, using their unique style and principles. Start the response with their name (e.g., "Наваль: ...").
4.  If no advisor is mentioned, provide a general, helpful response as the facilitator.
5.  The answer must be concise and directly address the user's question.
  `,
});

const continueDialogueFlow = ai.defineFlow(
  {
    name: 'continueDialogueFlow',
    inputSchema: ContinueDialogueInputSchema,
    outputSchema: ContinueDialogueOutputSchema,
  },
  async input => {
    const {output} = await continueDialoguePrompt({...input, advisorProfiles});
    return output!;
  }
);
