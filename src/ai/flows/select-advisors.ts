'use server';
/**
 * @fileOverview Dynamically selects advisors based on the user's situation.
 *
 * - selectAdvisors - A function that selects the most relevant advisors.
 * - SelectAdvisorsInput - The input type for the selectAdvisors function.
 * - SelectAdvisorsOutput - The return type for the selectAdvisors function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {advisorProfiles} from '@/ai/advisors';

const SelectAdvisorsInputSchema = z.object({
  situationDescription: z.string().describe('The user-provided description of their situation.'),
});
export type SelectAdvisorsInput = z.infer<typeof SelectAdvisorsInputSchema>;

const SelectAdvisorsOutputSchema = z.object({
  advisors: z
    .array(
      z.object({
        id: z.string().describe('The unique identifier for the advisor.'),
        name: z.string().describe('The name of the advisor.'),
        description: z.string().describe('A very brief (3-5 word) description of the advisor\'s expertise relevant to the specific situation.'),
      })
    )
    .length(5)
    .describe('An array of exactly 5 selected advisors.'),
});
export type SelectAdvisorsOutput = z.infer<typeof SelectAdvisorsOutputSchema>;

export async function selectAdvisors(
  input: SelectAdvisorsInput
): Promise<SelectAdvisorsOutput> {
  return selectAdvisorsFlow(input);
}

const selectAdvisorsPrompt = ai.definePrompt({
  name: 'selectAdvisorsPrompt',
  input: {
    schema: z.object({
      situationDescription: z.string(),
      advisorList: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
        })
      ),
    }),
  },
  output: {schema: SelectAdvisorsOutputSchema},
  prompt: `You are an expert at assembling personal advisory boards.
Your task is to select the 5 most relevant advisors from the provided list to help with the user's situation. Ensure a diversity of perspectives. Your response MUST be in Russian.

USER'S SITUATION:
"{{situationDescription}}"

AVAILABLE ADVISORS:
{{#each advisorList}}
- ID: {{this.id}}, Name: {{this.name}}, Expertise: {{this.description}}
{{/each}}

INSTRUCTIONS:
1.  Analyze the user's situation carefully.
2.  Select exactly 5 advisors from the list who would provide the most valuable and diverse insights for this specific problem.
3.  For each of the 5 selected advisors, write a new, very concise (3-5 word) description explaining why they are a good fit for THIS situation.
4.  Output the result in the specified JSON format. The 'id' and 'name' must match the original advisor data exactly.
`,
});

const selectAdvisorsFlow = ai.defineFlow(
  {
    name: 'selectAdvisorsFlow',
    inputSchema: SelectAdvisorsInputSchema,
    outputSchema: SelectAdvisorsOutputSchema,
  },
  async input => {
    // Convert the advisorProfiles object into the format the prompt expects
    const advisorList = Object.entries(advisorProfiles).map(
      ([id, profile]) => ({
        id,
        name: profile.name,
        // The description here is a general one for the model to use for selection
        description: `${profile.style} ${profile.principles}`,
      })
    );
    
    const {output} = await selectAdvisorsPrompt({
      situationDescription: input.situationDescription,
      advisorList,
    });
    
    if (!output) {
      throw new Error('AI model returned no output for advisor selection.');
    }
    
    return output;
  }
);

    