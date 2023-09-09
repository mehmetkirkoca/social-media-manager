const rewire = require('rewire');
const formatter = rewire('../index');

describe('formatForTwitter', () => {
  it('should format a message for Twitter', async () => {
    const message = 'Hello, Twitter!';
    const formatForTwitter = formatter.__get__('formatForTwitter');
    const result = await formatForTwitter(message);
    expect(result).toBe('message formatted for twitter: Hello, Twitter!');
  });
});

describe('formatForLinkedin', () => {
  it('should format a message for LinkedIn', async () => {
    const message = 'Hello, LinkedIn!';
    const formatForLinkedin = formatter.__get__('formatForLinkedin');

    const result = await formatForLinkedin(message);
    expect(result).toBe('message formatted for linkedin: Hello, LinkedIn!');
  });
});