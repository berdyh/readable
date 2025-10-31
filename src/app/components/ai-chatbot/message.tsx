"use client";

import { clsx } from "clsx";
import { Bot, User } from "lucide-react";

interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: "user" | "assistant";
  children: React.ReactNode;
  className?: string;
}

export function Message({ from, children, className, ...props }: MessageProps) {
  return (
    <div
      className={clsx(
        "flex gap-3",
        from === "user" ? "flex-row-reverse" : "flex-row",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageAvatar({
  src,
  name,
  from,
}: {
  src?: string;
  name?: string;
  from: "user" | "assistant";
}) {
  const AvatarIcon = from === "user" ? User : Bot;

  return (
    <div
      className={clsx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        from === "user"
          ? "bg-blue-600 text-white"
          : "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100",
      )}
    >
      {src ? (
        <img src={src} alt={name || from} className="h-full w-full rounded-full object-cover" />
      ) : (
        <AvatarIcon className="h-4 w-4" />
      )}
    </div>
  );
}

export function MessageContent({
  children,
  className,
  citations,
  reasoning,
}: {
  children: React.ReactNode;
  className?: string;
  citations?: Array<{ id: string; title: string; url?: string }>;
  reasoning?: string;
}) {
  return (
    <div className={clsx("flex-1 space-y-2", className)}>
      <div
        className={clsx(
          "rounded-lg px-4 py-3 text-sm",
          "bg-neutral-100 text-neutral-900",
          "dark:bg-neutral-800 dark:text-neutral-100",
        )}
      >
        {children}
      </div>
      {reasoning && (
        <div
          className={clsx(
            "rounded-lg border px-3 py-2 text-xs",
            "border-neutral-200 bg-neutral-50 text-neutral-700",
            "dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300",
          )}
        >
          <div className="font-semibold mb-1">Reasoning:</div>
          <div>{reasoning}</div>
        </div>
      )}
      {citations && citations.length > 0 && (
        <div
          className={clsx(
            "rounded-lg border px-3 py-2 text-xs",
            "border-neutral-200 bg-neutral-50",
            "dark:border-neutral-700 dark:bg-neutral-900/50",
          )}
        >
          <div className="font-semibold mb-2 text-neutral-700 dark:text-neutral-300">
            Sources:
          </div>
          <ul className="space-y-1">
            {citations.map((cite) => (
              <li key={cite.id}>
                {cite.url ? (
                  <a
                    href={cite.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {cite.title}
                  </a>
                ) : (
                  <span className="text-neutral-600 dark:text-neutral-400">{cite.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


