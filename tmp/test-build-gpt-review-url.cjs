const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync('tmp/build-gpt-current.js', 'utf8');

const mockItems = [
  {
    json: {
      classification: { category: 'technology', is_deal: false },
      user_profile: {},
      protagonist: {
        description: 'brunette woman',
        gender: 'female',
        hair_color: 'brunette'
      },
      story: {
        title: 'Rental market update',
        text: 'A story about apartments and city housing.'
      },
      images_results: [
        {
          original: 'https://www.renthop.com/blog/wp-content/uploads/2021/03/image.png',
          thumbnail: 'https://serpapi.com/searches/example-thumbnail.jpg',
          title: 'Apartment image',
          source: 'RentHop',
          position: 1
        }
      ]
    }
  }
];

const context = {
  $input: {
    all: () => mockItems
  },
  console,
  URL
};

const wrapped = `(function(){${code}\n})();`;
const result = vm.runInNewContext(wrapped, context, { timeout: 1000 });
const body = result[0].json.body;
const inputImages = Array.from(body.input[0].content
  .filter((part) => part.type === 'input_image')
  .map((part) => part.image_url));

assert.deepEqual(inputImages, ['https://serpapi.com/searches/example-thumbnail.jpg']);

console.log('ok');
