"use server";

import { z } from "zod";
import {
  simulateAdvisorAdvice,
  type SimulateAdvisorAdviceOutput,
} from "@/ai/flows/simulate-advisor-advice";

const situationSchema = z.string().min(10, {
  message: "Please describe your situation in at least 10 characters.",
});

export async function getAdviceAction(
  situation: string
): Promise<{ data?: SimulateAdvisorAdviceOutput | null; error?: string }> {
  const validatedFields = situationSchema.safeParse(situation);

  if (!validatedFields.success) {
    return {
      error: validatedFields.error.flatten().formErrors[0] || "Invalid input.",
    };
  }

  try {
    const advice = await simulateAdvisorAdvice({
      situationDescription: validatedFields.data,
      selectedAdvisors: ["NavalRavikant", "PieterLevels", "GaryVaynerchuk"],
    });

    if (!advice || !advice.advisorAdvices || advice.advisorAdvices.length === 0) {
      return {
        error:
          "Sorry, I couldn't generate advice for your situation. Please try rephrasing.",
      };
    }

    return { data: advice };
  } catch (e) {
    console.error(e);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
