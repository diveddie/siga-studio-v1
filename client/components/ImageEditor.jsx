import { useEffect, useState } from 'react';

export function ImageEditor({ imageUrl, prompt, onEdit }) {
  const [segments, setSegments] = useState([]);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [loading, setLoading] = useState(false);

  // Fetch segments from SAM API when image loads
  useEffect(() => {
    async function fetchSegments() {
      setLoading(true);
      try {
        const response = await fetch('/get-segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl })
        });
        
        const data = await response.json();
        setSegments(data.segments);
      } catch (error) {
        console.error('Failed to get segments:', error);
      } finally {
        setLoading(false);
      }
    }

    if (imageUrl) {
      fetchSegments();
    }
  }, [imageUrl]);

  const handleEdit = async () => {
    if (!selectedSegment) return;

    try {
      const response = await fetch('/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageFile: imageUrl,
          mask: selectedSegment.maskUrl,
          prompt: prompt
        })
      });

      const data = await response.json();
      onEdit(data[0].url);
    } catch (error) {
      console.error('Failed to edit image:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="text-gray-600">Analyzing image segments...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <img 
          src={imageUrl} 
          alt="Original image"
          className="w-full rounded-md"
        />
        {selectedSegment && (
          <img 
            src={selectedSegment.maskUrl} 
            alt="Selected segment mask"
            className="absolute top-0 left-0 w-full h-full opacity-50"
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">Select area to edit:</h3>
        <div className="grid grid-cols-2 gap-2">
          {segments.map((segment, index) => (
            <button
              key={index}
              onClick={() => setSelectedSegment(segment)}
              className={`p-2 text-left rounded-md ${
                selectedSegment === segment 
                  ? 'bg-blue-100 border-2 border-blue-500' 
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
              aria-label={`Select ${segment.description}`}
            >
              {segment.description}
            </button>
          ))}
        </div>
      </div>

      <button 
        onClick={handleEdit}
        className="bg-blue-500 text-white px-4 py-2 rounded"
        disabled={!selectedSegment}
        aria-label={selectedSegment 
          ? `Edit ${selectedSegment.description} with prompt: ${prompt}` 
          : 'Select an area to edit first'
        }
      >
        Apply Edit
      </button>
    </div>
  );
}
