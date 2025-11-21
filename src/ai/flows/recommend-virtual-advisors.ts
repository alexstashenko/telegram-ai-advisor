'use server';

/**
 * @fileOverview Recommends top 5 relevant public figures for a virtual advisory board based on the user's described situation.
 *
 * - recommendVirtualAdvisors - A function that recommends virtual advisors.
 * - RecommendVirtualAdvisorsInput - The input type for the recommendVirtualAdvisors function.
 * - RecommendVirtualAdvisorsOutput - The return type for the recommendVirtualAdvisors function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const RecommendVirtualAdvisorsInputSchema = z.string().describe('A description of the user\u0027s current life, work, or business situation.');
export type RecommendVirtualAdvisorsInput = z.infer<typeof RecommendVirtualAdvisorsInputSchema>;

const RecommendVirtualAdvisorsOutputSchema = z.array(
  z.object({
    name: z.string().describe('The name of the public figure.'),
    description: z.string().describe('A short description of the public figure and why they are a good fit.'),
  })
).describe('A list of the top 5 relevant public figures for a virtual advisory board.');
export type RecommendVirtualAdvisorsOutput = z.infer<typeof RecommendVirtualAdvisorsOutputSchema>;

export async function recommendVirtualAdvisors(input: RecommendVirtualAdvisorsInput): Promise<RecommendVirtualAdvisorsOutput> {
  return recommendVirtualAdvisorsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'recommendVirtualAdvisorsPrompt',
  input: {schema: RecommendVirtualAdvisorsInputSchema},
  output: {schema: RecommendVirtualAdvisorsOutputSchema},
  prompt: `You are an AI assistant that recommends the top 5 most relevant public figures for a virtual advisory board based on a user's described situation.  The output must be a JSON array.

Situation: {{{$input}}}

Format your response as a JSON array of objects with \"name\" and \"description\" fields. The description should be a short description of the public figure and why they are a good fit for the user's situation.
`,
});

const recommendVirtualAdvisorsFlow = ai.defineFlow(
  {
    name: 'recommendVirtualAdvisorsFlow',
    inputSchema: RecommendVirtualAdvisorsInputSchema,
    outputSchema: RecommendVirtualAdvisorsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
