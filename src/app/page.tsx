"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Image from "next/image";
import { getAdviceAction } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { cn } from "@/lib/utils";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BoardViewLogo } from "@/components/boardview-logo";
import { BrainCircuit, Flame, LoaderCircle, Users, Zap } from "lucide-react";
import type { SimulateAdvisorAdviceOutput } from "@/ai/flows/simulate-advisor-advice";

const advisors = [
  {
    name: "Naval Ravikant",
    title: "Philosopher & Investor",
    id: "NavalRavikant",
    description: "Focuses on long-term thinking, leverage, and personal happiness.",
    image: PlaceHolderImages.find((img) => img.id === "naval-ravikant"),
  },
  {
    name: "Pieter Levels",
    title: "Indie-Hacker & Maker",
    id: "PieterLevels",
    description:
      "Advocates for building in public, shipping fast, and bootstrapping.",
    image: PlaceHolderImages.find((img) => img.id === "pieter-levels"),
  },
  {
    name: "Gary Vaynerchuk",
    title: "Entrepreneur & Executor",
    id: "GaryVaynerchuk",
    description:
      "Emphasizes extreme execution, work ethic, and brand building.",
    image: PlaceHolderImages.find((img) => img.id === "gary-vaynerchuk"),
  },
];

export default function Home() {
  const { toast } = useToast();
  const resultsRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<SimulateAdvisorAdviceOutput | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  const handleFormAction = async (formData: FormData) => {
    const situation = formData.get("situation") as string;

    startTransition(async () => {
      const response = await getAdviceAction(situation);

      if (response.error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: response.error,
        });
        setResult(null);
      } else if (response.data) {
        setResult(response.data);
      }
    });
  };

  useEffect(() => {
    if (result) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  const getAdvisorInfo = (advisorId: string) => {
    const advisor = advisors.find((a) => a.id === advisorId);
    let icon = <Users className="h-5 w-5" />;
    if (advisorId === "NavalRavikant")
      icon = <BrainCircuit className="h-5 w-5 text-blue-500" />;
    if (advisorId === "PieterLevels")
      icon = <Zap className="h-5 w-5 text-amber-500" />;
    if (advisorId === "GaryVaynerchuk")
      icon = <Flame className="h-5 w-5 text-red-500" />;

    return { name: advisor?.name, icon };
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-20 items-center justify-between px-4 md:px-6">
          <BoardViewLogo />
        </div>
      </header>

      <main className="flex-1">
        <section className="container mx-auto px-4 py-12 md:px-6 md:py-20 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-headline text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Your Personal AI Advisory Board
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Describe your situation and get multi-faceted advice from a virtual
              board of world-class thinkers and entrepreneurs.
            </p>
          </div>
        </section>

        <section className="container mx-auto px-4 md:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-8 text-center font-headline text-3xl font-bold">
              Meet Your Board
            </h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {advisors.map((advisor) => (
                <Card key={advisor.id} className="text-center shadow-sm transition-shadow hover:shadow-md">
                  <CardHeader className="items-center">
                    {advisor.image && (
                      <Image
                        src={advisor.image.imageUrl}
                        alt={`Portrait of ${advisor.name}`}
                        width={80}
                        height={80}
                        className="rounded-full ring-2 ring-primary/10"
                        data-ai-hint={advisor.image.imageHint}
                      />
                    )}
                    <CardTitle className="font-headline pt-4">
                      {advisor.name}
                    </CardTitle>
                    <CardDescription>{advisor.title}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {advisor.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section
          id="get-advice"
          className="container mx-auto px-4 py-12 md:px-6 md:py-20"
        >
          <div className="mx-auto max-w-3xl">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="font-headline text-2xl">
                  Describe Your Situation
                </CardTitle>
                <CardDescription>
                  Tell us about your challenge, idea, or dilemma. The more
                  detail, the better the advice.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form ref={formRef} action={handleFormAction}>
                  <div className="grid w-full gap-4">
                    <Textarea
                      name="situation"
                      placeholder="e.g., I'm a software developer with a side project that's getting some traction, but I'm not sure how to turn it into a real business..."
                      className="min-h-[150px] text-base"
                      required
                    />
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="w-full sm:w-auto sm:place-self-end"
                      size="lg"
                    >
                      {isPending ? (
                        <>
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          Getting Advice...
                        </>
                      ) : (
                        "Get Advice from the Board"
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>

        {isPending && (
          <div className="container mx-auto px-4 pb-12 text-center md:px-6 md:pb-20">
            <div className="flex flex-col items-center justify-center gap-4">
              <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
              <p className="font-headline text-muted-foreground">
                Synthesizing perspectives...
              </p>
            </div>
          </div>
        )}

        {result && (
          <section
            ref={resultsRef}
            id="advice"
            className="container mx-auto px-4 pb-12 md:px-6 md:pb-20"
          >
            <div className="mx-auto max-w-3xl">
              <h2 className="mb-8 text-center font-headline text-3xl font-bold">
                Board Recommendations
              </h2>
              <Card>
                <CardContent className="p-0">
                  <Accordion
                    type="single"
                    collapsible
                    defaultValue="synthesis"
                    className="w-full"
                  >
                    {result.advisorAdvices?.map((adviceItem) => (
                      <AccordionItem
                        key={adviceItem.advisorName}
                        value={adviceItem.advisorName}
                        className="px-6"
                      >
                        <AccordionTrigger className="text-lg font-headline hover:no-underline">
                          <div className="flex items-center gap-3">
                            {getAdvisorInfo(adviceItem.advisorName).icon}
                            {getAdvisorInfo(adviceItem.advisorName).name}'s
                            Perspective
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 text-base leading-relaxed text-muted-foreground">
                          {adviceItem.advice
                            .split("\n")
                            .filter((p) => p.trim() !== "")
                            .map((p, i) => (
                              <p key={i}>{p}</p>
                            ))}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                     {result.synthesis && (
                    <AccordionItem value="synthesis" className="border-t-8 border-accent/20">
                      <AccordionTrigger className="px-6 text-lg font-headline font-bold text-primary hover:no-underline">
                        Synthesized Action Plan
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 px-6 pt-2 text-base leading-relaxed text-card-foreground">
                        {result.synthesis
                          .split("\n")
                          .filter((p) => p.trim() !== "")
                          .map((p, i) => (
                            <p key={i}>{p}</p>
                          ))}
                      </AccordionContent>
                    </AccordionItem>
                     )}
                  </Accordion>
                </CardContent>
              </Card>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t">
        <div className="container mx-auto flex h-16 items-center justify-center px-4 md:px-6">
          <p className="text-center text-sm text-muted-foreground">
            Built with BoardView AI. All advice is AI-generated and for
            informational purposes only.
          </p>
        </div>
      </footer>
    </div>
  );
}
