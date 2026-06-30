"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Sparkles, RefreshCw, AlertCircle, Send, Loader2 } from "lucide-react";
import { askFollowUp } from "@/lib/actions/ai.actions";

interface AIChatCardProps {
  title: string;
  subtitle: string;
  fetchData: (forceRefresh?: boolean) => Promise<string>;
}

export default function AIChatCard({
  title,
  subtitle,
  fetchData,
}: AIChatCardProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; text: string }[]
  >([]);
  const [answering, setAnswering] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(false);
      setMessages([]);
      setQuestion("");
      try {
        const text = await fetchData(forceRefresh);
        setContent(text);
      } catch {
        setError(true);
        setContent(null);
      } finally {
        setLoading(false);
      }
    },
    [fetchData],
  );

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || !content || answering) return;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setAnswering(true);
    try {
      const text = await askFollowUp(content, q);
      setMessages((prev) => [...prev, { role: "ai", text }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "Sorry, I couldn't process your question." },
      ]);
    } finally {
      setAnswering(false);
      setTimeout(
        () => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    }
  }, [question, content, answering]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-teal-900/40 bg-gradient-to-br from-gray-900 via-gray-950 to-black p-6 md:p-8 shadow-lg shadow-teal-900/5">
      {/* Background decorative gradient */}
      <div className="pointer-events-none absolute -inset-px opacity-40">
        <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-teal-500/5 blur-3xl" />
      </div>

      <div className="relative">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500/20 to-teal-500/5 ring-1 ring-teal-500/20">
              <Sparkles className="h-5 w-5 text-teal-400" />
            </div>
            <div>
              <h2 className="text-base font-bold uppercase tracking-[0.18em] text-gray-300">
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-700/60 bg-gray-800/50 px-3 py-2 text-xs font-medium text-gray-400 transition-all hover:border-teal-700 hover:bg-teal-500/10 hover:text-teal-300 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {/* Content area */}
        <div className="max-h-[400px] min-h-[72px] overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700">
          {loading && (
            <div className="space-y-3">
              <div className="h-5 w-full animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
              <div className="h-5 w-5/6 animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
              <div className="h-5 w-4/6 animate-pulse rounded-md bg-gradient-to-r from-gray-800 via-gray-700/60 to-gray-800" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-900/30 bg-rose-950/10 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div>
                <p className="font-medium text-rose-300">
                  Unable to generate {title.toLowerCase()}
                </p>
                <p className="mt-1 text-sm text-rose-400/80">
                  The AI service is temporarily unavailable.{" "}
                  <button
                    onClick={() => load(true)}
                    className="font-medium underline underline-offset-2 hover:text-rose-200"
                  >
                    Try again
                  </button>
                </p>
              </div>
            </div>
          )}

          {!loading && !error && content && (
            <>
              <div className="rounded-xl border border-teal-900/20 bg-gradient-to-r from-teal-500/5 to-transparent p-5">
                <p className="text-base leading-relaxed text-gray-200 md:text-lg">
                  {content}
                </p>
                <div className="mt-4 flex items-center gap-2 border-t border-gray-800/60 pt-3">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-teal-500" />
                  <p className="text-xs text-gray-600">
                    AI-generated — verify important information
                  </p>
                </div>
              </div>

              {/* Follow-up chat */}
              {messages.length > 0 && (
                <div className="mt-4 max-h-80 space-y-3 overflow-y-auto rounded-xl border border-gray-800/60 bg-black/20 p-3 [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-teal-600/20 text-teal-200"
                            : "bg-gray-800/60 text-gray-300"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                  placeholder="Ask a follow-up question…"
                  disabled={answering}
                  className="flex-1 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 outline-none transition-colors focus:border-teal-700 disabled:opacity-50"
                />
                <button
                  onClick={handleAsk}
                  disabled={!question.trim() || answering}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-700/60 bg-gray-800/50 text-gray-400 transition-colors hover:border-teal-700 hover:text-teal-300 disabled:opacity-40"
                >
                  {answering ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
