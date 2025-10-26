"use client";

export interface SlashCommandOption {
  id: string;
  label: string;
  description: string;
}

interface SlashCommandMenuProps {
  options: SlashCommandOption[];
  activeIndex: number;
  onSelect: (option: SlashCommandOption) => void;
  onHighlight?: (index: number) => void;
}

const SlashCommandMenu = ({
  options,
  activeIndex,
  onSelect,
  onHighlight,
}: SlashCommandMenuProps) => {
  if (!options.length) {
    return null;
  }

  return (
    <div className="absolute bottom-[110%] left-0 z-30 w-full rounded-lg border border-zinc-200 bg-white p-2 shadow-xl">
      <div className="flex flex-col gap-1">
        {options.map((option, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              type="button"
              key={option.id}
              onClick={() => onSelect(option)}
              onMouseEnter={() => onHighlight?.(index)}
              className={`flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-left transition ${
                isActive
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <span
                className={`text-xs ${
                  isActive ? "text-zinc-200" : "text-zinc-400"
                }`}
              >
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SlashCommandMenu;
