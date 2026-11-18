import fal_client, os, json, urllib.request
os.environ['FAL_KEY'] = [l.split('=', 1)[1].strip().strip('"\'') for l in open(os.path.expanduser('~/.bashrc')) if 'FAL_KEY=' in l][0]
I = os.path.expanduser('~/video-projects/ilbirs/assets/master/')
O = os.path.expanduser('~/projects/barsbek-walk/source-art/')

base = fal_client.upload_file(O + 'turnaround_3d_1.png')                  # утверждённый вариант 1 (одежда, поза, раскладка)
head = fal_client.upload_file(I + 'barsbek_sheet_2_head_expressions.jpg')  # утверждённая голова
tail = fal_client.upload_file(I + 'barsbek_sheet_3_detail_callouts.jpg')   # макро: хвост, кисть, мех

prompt = {
  "task": "Edit Image 1, a 3D-modeling turnaround sheet (front / side profile / back). Keep EVERYTHING the same: same character, same face, same outfit and colors, same A-pose, same layout, scale, white background, flat lighting. Make ONLY the two changes below.",
  "change_1_hands": "make both hands noticeably SMALLER, about 20 percent smaller than now, in natural proportion to the arms, the same size as a human hand relative to the body: compact palm, slimmer fluffy fingers, short pale claws barely visible; NO long dark claws, NO oversized paws",
  "change_2_tail": {
    "add": "ONE thick fluffy snow leopard tail, as in Image 3",
    "root": "emerges from the lower back just above the buttocks, through a neat slot in the joggers, thick base flowing smoothly out of the body",
    "shape": "a smooth gentle arc: from the root it goes BACKWARD and slightly downward, the middle stays about knee height above the ground, the tip curls slightly upward; one continuous curve with no sharp bends",
    "clearance": "the tail does NOT touch the ground, does NOT touch the legs, and does NOT hang straight down",
    "length": "long, about 85 cm",
    "pattern": "smoky-white fur with bold open charcoal ring rosettes along the whole tail, solid black tip",
    "per_view": "side view: whole tail clearly visible behind the body in profile; back view: tail root visible at the lower back, tail going away from the viewer; front view: only a little of the tail visible behind the legs"
  },
  "negative": ["two tails", "tail on the ground", "tail lying on the floor", "tail hanging straight down", "sharp bend in tail", "tail between legs", "big hands", "oversized paws", "long claws", "dark claws", "text", "labels", "logos", "floor shadow", "props"]
}

r = fal_client.subscribe('openai/gpt-image-2.5/sunburst/edit', arguments={
    "prompt": json.dumps(prompt, ensure_ascii=False),
    "image_urls": [base, head, tail],
    "image_size": {"width": 1824, "height": 1024},
    "quality": "high", "num_images": 2, "output_format": "png"}, client_timeout=600)
for i, im in enumerate(r['images']):
    p = O + f'turnaround_3d_v2_{i+1}.png'
    urllib.request.urlretrieve(im['url'], p)
    print('saved', p)
