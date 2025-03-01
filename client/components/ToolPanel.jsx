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
            guidance: {
              type: "number",
              description: "Guidance scale for image generation (higher values make the image more closely match the prompt)",
              default: 3.5,
              minimum: 1,
              maximum: 20
            }
          },
          required: ["prompt"],
        },
      },
      {
        type: "function",
        name: "edit_image",
        description: "Call this function when a user asks to edit or modify an existing image",
        parameters: {
          type: "object",
          strict: true,
          properties: {
            imageUrl: {
              type: "string",
              description: "URL of the image to edit"
            },
            prompt: {
              type: "string",
              description: "Description of the desired edits"
            }
          },
          required: ["imageUrl", "prompt"]
        }
      },
      {
        type: "function",
        name: "get_image_segments",
        description: "Call this function when a user asks to get the image segments.",
        parameters: {
          type: "object",
          strict: true,
          properties: {
            imageUrl: {
              type: "string",
              description: "URL of the image to analyze for segments"
            }
          },
          required: ["imageUrl"]
        }
      }
    ],
    tool_choice: "auto",
  },
};

function ImageGenerator({ prompt, guidance = 3.5 }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function generateImage() {
      try {
        const response = await fetch("/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, guidance }),
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
  }, [prompt, guidance]);

  return (
    <div className="flex flex-col gap-2">
      <p>Prompt: {prompt}</p>
      {error && <p className="text-red-500">{error}</p>}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={prompt}
          className="w-full rounded-lg shadow-lg"
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

  if (functionCallOutput.name === "get_image_segments") {
    const { imageUrl } = JSON.parse(functionCallOutput.arguments);
    return (
      <div className="flex flex-col gap-2">
        <ImageSegmenter imageUrl={imageUrl} />
        <pre className="text-xs bg-gray-100 rounded-md p-2 overflow-x-auto">
          {JSON.stringify(functionCallOutput, null, 2)}
        </pre>
      </div>
    );
  }

  return null;
}

function ImageSegmenter({ imageUrl }) {
  const [segments, setSegments] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getSegments() {
      try {
        const response = await fetch("/get-segments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl }),
        });

        const data = await response.json();
        if (data.error) {
          setError(data.error);
        } else {
          setSegments(data);
        }
      } catch (err) {
        setError("Failed to analyze image segments");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    getSegments();
  }, [imageUrl]);

  if (loading) {
    return <div>Analyzing image segments...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="font-bold mb-2">Original Image</h3>
          <img src={imageUrl} alt="Original" className="w-full rounded-lg" />
        </div>
        <div>
          <h3 className="font-bold mb-2">Combined Segments</h3>
          <img src={segments.combined_mask} alt="Combined segments" className="w-full rounded-lg" />
        </div>
      </div>
      <div>
        <h3 className="font-bold mb-2">Individual Segments</h3>
        <div className="grid grid-cols-3 gap-2">
          {segments.individual_masks.map((mask, index) => (
            <img 
              key={index} 
              src={mask} 
              alt={`Segment ${index + 1}`} 
              className="w-full rounded-lg"
            />
          ))}
        </div>
      </div>
    </div>
  );
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
