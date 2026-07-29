import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnswerCard } from "./answer-card";

/**
 * The trust strip is the first thing in the card because whether an answer is
 * grounded matters more than what it says. These assert what a reader is
 * actually told, which is the part that cannot be checked by types: the same
 * answer text is honest or misleading depending on the strip above it.
 */
describe("AnswerCard trust strip", () => {
  it("calls a cited answer grounded", () => {
    render(
      <AnswerCard
        paperId="2301.00001"
        content="The Transformer removes recurrence."
        trust={{ status: "sourced" }}
        citations={[{ chunkId: "c1", page: 3, quote: "self-attention" }]}
      />,
    );

    expect(screen.getByText("Grounded answer")).toBeInTheDocument();
    expect(screen.getByText(/can be opened in the paper/i)).toBeInTheDocument();
  });

  it("says evidence needs review when the answer is uncited", () => {
    render(
      <AnswerCard
        paperId="2301.00001"
        content="Probably about attention."
        trust={{ status: "uncited" }}
      />,
    );

    expect(screen.getByText("Evidence needs review")).toBeInTheDocument();
  });

  it("does not claim grounding when a refusal comes back", () => {
    render(
      <AnswerCard
        paperId="2301.00001"
        content="I cannot answer that."
        trust={{ status: "refused" }}
      />,
    );

    expect(screen.getByText("Answer unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Grounded answer")).not.toBeInTheDocument();
  });

  it("marks a pre-trust persisted answer as legacy rather than grounded", () => {
    // Messages written before trust metadata existed have citations but no
    // trust field. Rendering those as "Grounded answer" would assert a check
    // that never ran.
    render(
      <AnswerCard
        paperId="2301.00001"
        content="An older stored answer."
        citations={[{ chunkId: "c1", page: 1, quote: "older" }]}
      />,
    );

    expect(screen.getByText("Legacy answer")).toBeInTheDocument();
    expect(screen.queryByText("Grounded answer")).not.toBeInTheDocument();
  });

  it("says source proof is unavailable when there is neither trust nor a citation", () => {
    render(<AnswerCard paperId="2301.00001" content="No sources at all." />);

    expect(screen.getByText("Source proof unavailable")).toBeInTheDocument();
  });

  it("surfaces the first warning instead of the generic detail line", () => {
    render(
      <AnswerCard
        paperId="2301.00001"
        content="Partial answer."
        trust={{ status: "uncited", warnings: ["Vector search was unavailable."] }}
      />,
    );

    expect(screen.getByText("Vector search was unavailable.")).toBeInTheDocument();
  });
});
