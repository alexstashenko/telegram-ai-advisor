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
  prompt: `You are a facilitator of a personal advisory board. The user is asking a follow-up question.
  Continue the conversation naturally. If the user addresses a specific advisor, answer from their perspective, using their known style and principles.
  Your response must be in Russian.

  Advisor Profiles for reference:
  Naval Ravikant: Name: {{lookup ../advisorProfiles "NavalRavikant" "name"}}, Style: {{lookup ../advisorProfiles "NavalRavikant" "style"}}, Principles: {{lookup ../advisorProfiles "NavalRavikant" "principles"}}
  Pieter Levels: Name: {{lookup ../advisorProfiles "PieterLevels" "name"}}, Style: {{lookup ../advisorProfiles "PieterLevels" "style"}}, Principles: {{lookup ../advisorProfiles "PieterLevels" "principles"}}
  Gary Vaynerchuk: Name: {{lookup ../advisorProfiles "GaryVaynerchuk" "name"}}, Style: {{lookup ../advisorProfiles "GaryVaynerchuk" "style"}}, Principles: {{lookup ../advisorProfiles "GaryVaynerchuk" "principles"}}

  Conversation History:
  {{#each history}}
  - {{role}}: {{content}}
  {{/each}}

  User's new question: {{question}}

  Based on the history and the new question, provide a concise and helpful answer.
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
