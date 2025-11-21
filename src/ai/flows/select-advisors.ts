'use server';
/**
 * @fileOverview Dynamically generates advisors based on the user's situation.
 *
 * - selectAdvisors - A function that generates the most relevant advisors.
 * - SelectAdvisorsInput - The input type for the selectAdvisors function.
 * - SelectAdvisorsOutput - The return type for the selectAdvisors function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SelectAdvisorsInputSchema = z.object({
  situationDescription: z.string().describe('The user-provided description of their situation.'),
});
export type SelectAdvisorsInput = z.infer<typeof SelectAdvisorsInputSchema>;

// Полный профиль советника
export const AdvisorProfileSchema = z.object({
  id: z.string().describe('Unique identifier (use lowercase name without spaces, e.g., "elonmusk", "mariecurie")'),
  name: z.string().describe('Full name of the advisor'),
  description: z.string().describe('Brief (3-5 word) description of their expertise relevant to this situation'),
  style: z.string().describe('Their communication and thinking style'),
  principles: z.string().describe('Key principles and philosophies they follow'),
  tone: z.string().describe('The tone they use when giving advice'),
});

export type AdvisorProfile = z.infer<typeof AdvisorProfileSchema>;

const SelectAdvisorsOutputSchema = z.object({
  advisors: z
    .array(AdvisorProfileSchema)
    .length(5)
    .describe('An array of exactly 5 generated advisors with full profiles.'),
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
    }),
  },
  output: {schema: SelectAdvisorsOutputSchema},
  prompt: `You are an expert at assembling personal advisory boards. Your task is to CREATE 5 unique advisors who would be most valuable for the user's specific situation.

USER'S SITUATION:
"{{situationDescription}}"

INSTRUCTIONS:
1. Analyze the user's situation deeply.
2. CREATE exactly 5 advisors who would provide diverse, valuable perspectives for THIS specific situation.
3. You can choose real historical or contemporary figures (e.g., Elon Musk, Marie Curie, Warren Buffett, Oprah Winfrey)
4. Ensure DIVERSITY: different fields, thinking styles, backgrounds, perspectives.
5. For EACH advisor, provide:
   - id: lowercase name without spaces (e.g., "elonmusk", "mariecurie")
   - name: Full name or title
   - description: Very brief (3-5 words) why they're relevant to THIS situation
   - style: How they think and communicate
   - principles: Their core philosophies and approaches
   - tone: How they typically speak/advise

6. Make the profiles rich and authentic - imagine how these people would ACTUALLY advise.
7. Your response MUST be in Russian (names can be in original language, but all descriptions in Russian).

OUTPUT:
Return exactly 5 advisors in the specified JSON format.
`,
});

const selectAdvisorsFlow = ai.defineFlow(
  {
    name: 'selectAdvisorsFlow',
    inputSchema: SelectAdvisorsInputSchema,
    outputSchema: SelectAdvisorsOutputSchema,
  },
  async input => {
    const {output} = await selectAdvisorsPrompt({
      situationDescription: input.situationDescription,
    });
    
    if (!output || !output.advisors || output.advisors.length !== 5) {
      throw new Error('AI model returned invalid output for advisor generation.');
    }
    
    // Валидация уникальности ID
    const ids = output.advisors.map(a => a.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error('Generated advisor IDs are not unique.');
    }
    
    return output;
  }
);
    