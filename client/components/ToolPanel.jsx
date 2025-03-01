import { useEffect, useState } from "react";

const colorPaletteFunctionDescription = `
Call this function when a user asks for a color palette.
`;

const imageGenerationFunctionDescription = `
Call this function when a user asks to generate, create, or make an image.
`;

const imageEditFunctionDescription = `
Call this function when a user asks to edit or modify an existing image.
`;

const imageSegmentFunctionDescription = `
Call this function when a user asks to mask a specific object in an image.
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
        name: "create_image_mask",
        description: "Call this function when a user asks to mask a specific object in an image",
        parameters: {
          type: "object",
          strict: true,
          properties: {
            currentImageUrl: {
              type: "string",
              description: "URL of the current image to analyze for segments"
            },
            prompt: {
              type: "string",
              description: "What to look for in the image (e.g., 'car', 'person', 'dog')"
            }
          },
          required: ["currentImageUrl", "prompt"]
        }
      }
    ],
    tool_choice: "auto",
  },
};

function ImageSegmenter({ imageUrl, prompt, shouldAnalyze }) {
  const [segments, setSegments] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  useEffect(() => {
    async function getSegments() {
      if (!imageUrl || !shouldAnalyze || hasAnalyzed) {
        return;
      }

      setLoading(true);
      try {
        const response = await fetch("/get-segments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            currentImageUrl: imageUrl,
            prompt: prompt || "object"
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setSegments(data);
        setHasAnalyzed(true);
      } catch (error) {
        console.error("Failed to get segments:", error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    }

    getSegments();
  }, [imageUrl, prompt, shouldAnalyze, hasAnalyzed]);

  // Reset hasAnalyzed when shouldAnalyze changes to false
  useEffect(() => {
    if (!shouldAnalyze) {
      setHasAnalyzed(false);
    }
  }, [shouldAnalyze]);

  if (!shouldAnalyze) {
    return null;
  }

  if (loading) {
    return <div>Analyzing image segments...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!segments) {
    return <div>No segments found</div>;
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
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [error, setError] = useState(null);

  // Define generateImage before useEffect
  const generateImage = async (prompt, guidance = 3.5) => {
    try {
      const response = await fetch("/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, guidance }),
      });

      const data = await response.json();
      if (data.error) {
        setError(data.error);
        return false;
      } else {
        setCurrentImageUrl(data[0].url);
        return true;
      }
    } catch (err) {
      setError("Failed to generate image");
      console.error(err);
      return false;
    }
  };

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
        if (output.type === "function_call") {
          // Clear previous function call output when switching functions
          setFunctionCallOutput(null);
          
          if (output.name === "generate_image") {
            const { prompt, guidance = 3.5 } = JSON.parse(output.arguments);
            generateImage(prompt, guidance).then(() => {
              // Only set the function call output after the image is generated
              setFunctionCallOutput(output);
            });
          } else if (output.name === "create_image_mask") {
            if (!currentImageUrl) {
              console.error("No image available for segmentation");
              return;
            }
            // Set the function call output with the current image URL
            setFunctionCallOutput({
              ...output,
              arguments: JSON.stringify({
                currentImageUrl,
                prompt: JSON.parse(output.arguments).prompt
              })
            });
          } else {
            // Handle other function calls (like color palette)
            setFunctionCallOutput(output);
          }

          // Send follow-up instructions
          setTimeout(() => {
            sendClientEvent({
              type: "response.create",
              response: {
                instructions:
                  output.name === "display_color_palette"
                    ? "ask for feedback about the color palette - don't repeat the colors, just ask if they like the colors."
                    : output.name === "generate_image"
                    ? "ask for feedback about the generated image - don't repeat the prompt, just ask if they like the image."
                    : output.name === "create_image_mask"
                    ? "ask if they'd like to edit any of the segments."
                    : "",
              },
            });
          }, 500);
        }
      });
    }
  }, [events, currentImageUrl, generateImage, functionAdded, sendClientEvent]);

  // Reset function
  useEffect(() => {
    if (!isSessionActive) {
      setFunctionAdded(false);
      setFunctionCallOutput(null);
      setCurrentImageUrl(null);
      setError(null);
    }
  }, [isSessionActive]);

  const FunctionCallOutput = ({ functionCallOutput }) => {
    if (!functionCallOutput) return null;
    const args = JSON.parse(functionCallOutput.arguments);

    return (
      <div className="flex flex-col gap-6">
        {/* Color Palette Section */}
        {args.colors && args.theme && (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">Color Palette</h3>
            <p>Theme: {args.theme}</p>
            <div className="grid grid-cols-5 gap-2">
              {args.colors.map((color) => (
                <div
                  key={color}
                  className="w-full h-16 rounded-md flex items-center justify-center border border-gray-200"
                  style={{ backgroundColor: color }}
                >
                  <p className="text-sm font-bold text-black bg-slate-100 rounded-md p-2 border border-black">
                    {color}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generated Image Section */}
        {currentImageUrl && (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">Generated Image</h3>
            {error && <p className="text-red-500">{error}</p>}
            <img
              src={currentImageUrl}
              alt="Generated image"
              className="w-full rounded-lg shadow-lg"
            />
          </div>
        )}

        {/* Image Segmentation Section */}
        {currentImageUrl && (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">Image Segmentation</h3>
            <ImageSegmenter 
              imageUrl={currentImageUrl} 
              prompt={args.prompt}
              shouldAnalyze={functionCallOutput.name === "create_image_mask"}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="h-[calc(100vh-150px)] w-full flex flex-col gap-4 mb-4">
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
