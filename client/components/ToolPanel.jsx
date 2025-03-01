import { useEffect, useState } from "react";

const colorPaletteFunctionDescription = `
Call this function when a user asks for a color palette.
`;

const imageGenerationFunctionDescription = `
Call this function when a user asks to generate, create, or make an image.
`;

const sessionUpdate = {
  type: "session.update",
  session: {
    tools: [
      {
        type: "function",
        name: "display_color_palette",
        description: colorPaletteFunctionDescription,
        parameters: {
          type: "object",
          strict: true,
          properties: {
            theme: {
              type: "string",
              description: "Description of the theme for the color scheme.",
            },
            colors: {
              type: "array",
              description: "Array of five hex color codes based on the theme.",
              items: {
                type: "string",
                description: "Hex color code",
              },
            },
          },
          required: ["theme", "colors"],
        },
      },
      {
        type: "function",
        name: "generate_image",
        description: imageGenerationFunctionDescription,
        parameters: {
          type: "object",
          strict: true,
          properties: {
            prompt: {
              type: "string",
              description: "Detailed description of the image to generate",
            },
            aspect_ratio: {
              type: "string",
              enum: ["ASPECT_1_1", "ASPECT_16_10", "ASPECT_10_16"],
              description: "Aspect ratio of the generated image",
              default: "ASPECT_1_1",
            },
          },
          required: ["prompt"],
        },
      },
    ],
    tool_choice: "auto",
  },
};

function ImageGenerator({ prompt }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function generateImage() {
      try {
        const response = await fetch("/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });

        const data = await response.json();
        if (data.error) {
          setError(data.error);
        } else {
          setImageUrl(data[0].url);
        }
      } catch (err) {
        setError("Failed to generate image");
        console.error(err);
      }
    }

    generateImage();
  }, [prompt]);

  return (
    <div className="flex flex-col gap-2">
      <p>Prompt: {prompt}</p>
      {error && <p className="text-red-500">{error}</p>}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={prompt}
          className="w-full rounded-md border border-gray-200"
        />
      )}
    </div>
  );
}

function FunctionCallOutput({ functionCallOutput }) {
  if (functionCallOutput.name === "display_color_palette") {
    const { theme, colors } = JSON.parse(functionCallOutput.arguments);
    const colorBoxes = colors.map((color) => (
      <div
        key={color}
        className="w-full h-16 rounded-md flex items-center justify-center border border-gray-200"
        style={{ backgroundColor: color }}
      >
        <p className="text-sm font-bold text-black bg-slate-100 rounded-md p-2 border border-black">
          {color}
        </p>
      </div>
    ));

    return (
      <div className="flex flex-col gap-2">
        <p>Theme: {theme}</p>
        {colorBoxes}
        <pre className="text-xs bg-gray-100 rounded-md p-2 overflow-x-auto">
          {JSON.stringify(functionCallOutput, null, 2)}
        </pre>
      </div>
    );
  }

  if (functionCallOutput.name === "generate_image") {
    const { prompt } = JSON.parse(functionCallOutput.arguments);
    return (
      <div className="flex flex-col gap-2">
        <ImageGenerator prompt={prompt} />
        <pre className="text-xs bg-gray-100 rounded-md p-2 overflow-x-auto">
          {JSON.stringify(functionCallOutput, null, 2)}
        </pre>
      </div>
    );
  }

  return null;
}

export default function ToolPanel({
  isSessionActive,
  sendClientEvent,
  events,
}) {
  const [functionAdded, setFunctionAdded] = useState(false);
  const [functionCallOutput, setFunctionCallOutput] = useState(null);

  useEffect(() => {
    if (!events || events.length === 0) return;

    const firstEvent = events[events.length - 1];
    if (!functionAdded && firstEvent.type === "session.created") {
      sendClientEvent(sessionUpdate);
      setFunctionAdded(true);
    }

    const mostRecentEvent = events[0];
    if (
      mostRecentEvent.type === "response.done" &&
      mostRecentEvent.response.output
    ) {
      mostRecentEvent.response.output.forEach((output) => {
        if (
          output.type === "function_call" &&
          (output.name === "display_color_palette" ||
            output.name === "generate_image")
        ) {
          setFunctionCallOutput(output);
          setTimeout(() => {
            sendClientEvent({
              type: "response.create",
              response: {
                instructions:
                  output.name === "display_color_palette"
                    ? "ask for feedback about the color palette - don't repeat the colors, just ask if they like the colors."
                    : "ask for feedback about the generated image - don't repeat the prompt, just ask if they like the image.",
              },
            });
          }, 500);
        }
      });
    }
  }, [events]);

  useEffect(() => {
    if (!isSessionActive) {
      setFunctionAdded(false);
      setFunctionCallOutput(null);
    }
  }, [isSessionActive]);

  return (
    <section className="h-full w-full flex flex-col gap-4">
      <div className="h-full bg-gray-50 rounded-md p-4">
        <h2 className="text-lg font-bold">Tools Panel</h2>
        {isSessionActive ? (
          functionCallOutput ? (
            <FunctionCallOutput functionCallOutput={functionCallOutput} />
          ) : (
            <p>Ask for a color palette or image generation...</p>
          )
        ) : (
          <p>Start the session to use these tools...</p>
        )}
      </div>
    </section>
  );
}
