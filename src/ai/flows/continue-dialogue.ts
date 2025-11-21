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

const ContinueDialogueInputSchema = z.object({
  question: z.string().describe("The user's follow-up question."),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string(),
  })).describe('The conversation history.'),
});

export type ContinueDialogueInput = z.infer<typeof ContinueDialogueInputSchema>;

const ContinueDialogueOutputSchema = z.object({
  answer: z.string().describe("The AI's response to the follow-up question."),
});

export type ContinueDialogueOutput = z.infer<typeof ContinueDialogueOutputSchema>;

export async function continueDialogue(input: ContinueDialogueInput): Promise<ContinueDialogueOutput> {
  return continueDialogueFlow(input);
}

const continueDialoguePrompt = ai.definePrompt({
  name: 'continueDialoguePrompt',
  input: {schema: ContinueDialogueInputSchema},
  output: {schema: ContinueDialogueOutputSchema},
  prompt: `You are a facilitator for a personal advisory board. Your task is to provide an answer to the user's follow-up question based on the provided conversation history.
Your response MUST be in Russian.

Conversation History:
{{#each history}}
- {{role}}: {{content}}
{{/each}}

User's new question: {{question}}

INSTRUCTIONS:
1.  Examine the "User's new question" and the "Conversation History" to understand which advisor is being addressed, or if it's a general question.
2.  **IF AN ADVISOR IS MENTIONED:** You MUST answer exclusively from that single advisor's perspective, using their known style and principles. Put advisor's first name at the beginning of text to be clear who is replying.
3.  **IF NO ADVISOR IS MENTIONED:** You MUST answer from the perspective of the facilitator, providing a general, helpful, and synthesized response based on the entire conversation.
4.  The answer MUST be concise and to the point (3-4 sentences maximum).
  `,
});

const continueDialogueFlow = ai.defineFlow(
  {
    name: 'continueDialogueFlow',
    inputSchema: ContinueDialogueInputSchema,
    outputSchema: ContinueDialogueOutputSchema,
  },
  async input => {
    const {output} = await continueDialoguePrompt(input);
    return output!;
  }
);

    
