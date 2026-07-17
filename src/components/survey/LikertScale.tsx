import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

interface LikertScaleProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
}

const POINTS = [1, 2, 3, 4, 5];

/**
 * 1–5 Likert row: five numbered circular buttons, keyboard-navigable via
 * Radix RadioGroup (arrow keys move selection, Tab enters/exits the group),
 * with "Strongly Disagree" / "Strongly Agree" end labels.
 */
export function LikertScale({ name, value, onChange, error }: LikertScaleProps) {
  return (
    <div className="survey-likert">
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={onChange}
        aria-label={name}
        className={cn("survey-likert-row", error && "survey-likert-row--error")}
      >
        {POINTS.map((point) => {
          const id = `${name}-${point}`;
          return (
            <div key={point} className="survey-likert-cell">
              <RadioGroupPrimitive.Item
                id={id}
                value={String(point)}
                className="survey-likert-radio"
              >
                <RadioGroupPrimitive.Indicator className="survey-likert-radio-fill" />
                <span className="survey-likert-number" aria-hidden="true">
                  {point}
                </span>
              </RadioGroupPrimitive.Item>
            </div>
          );
        })}
      </RadioGroupPrimitive.Root>
      <div className="survey-likert-labels">
        <span>Strongly Disagree</span>
        <span>Strongly Agree</span>
      </div>
    </div>
  );
}
