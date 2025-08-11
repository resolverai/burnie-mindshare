import React from 'react';
import ReactMarkdown from 'react-markdown';

/**
 * Markdown parser options
 */
export interface MarkdownParserOptions {
  className?: string;
}

/**
 * Render markdown content using react-markdown
 */
export const renderMarkdown = (content: string, options: MarkdownParserOptions = {}): React.ReactElement => {
  const { className = '' } = options;

  if (!content) return React.createElement('div');

  // Preprocess content to handle escaped characters
  const processedContent = content
    .replace(/\\n/g, '\n')  // Convert \n to actual newlines
    .replace(/\\t/g, '\t')  // Convert \t to actual tabs
    .replace(/\\r/g, '\r')  // Convert \r to actual carriage returns
    .replace(/\\\\/g, '\\') // Convert \\ to actual backslashes
    .trim(); // Remove leading/trailing whitespace

  return React.createElement(
    'div',
    { className: `markdown-content prose prose-sm max-w-none ${className}` },
    React.createElement(ReactMarkdown, {
      components: {
        h1: (props: any) => React.createElement('h1', { className: 'text-2xl font-bold mb-4 mt-6 text-gray-900' }, props.children),
        h2: (props: any) => React.createElement('h2', { className: 'text-xl font-bold mb-4 mt-6 text-gray-900' }, props.children),
        h3: (props: any) => React.createElement('h3', { className: 'text-lg font-semibold mb-3 mt-6 text-gray-900' }, props.children),
        p: (props: any) => React.createElement('p', { className: 'mb-4 text-gray-800 leading-relaxed' }, props.children),
        strong: (props: any) => React.createElement('strong', { className: 'font-semibold' }, props.children),
        em: (props: any) => React.createElement('em', { className: 'italic' }, props.children),
        code: (props: any) => React.createElement('code', { className: 'bg-gray-100 px-1 py-0.5 rounded text-sm font-mono' }, props.children),
        ul: (props: any) => React.createElement('ul', { className: 'list-disc ml-6 mb-4' }, props.children),
        ol: (props: any) => React.createElement('ol', { className: 'list-decimal ml-6 mb-4' }, props.children),
        li: (props: any) => React.createElement('li', { className: 'mb-2 text-gray-800' }, props.children),
        blockquote: (props: any) => React.createElement('blockquote', { className: 'border-l-4 border-gray-300 pl-4 py-2 mb-4 italic text-gray-700' }, props.children),
        pre: (props: any) => React.createElement('pre', { className: 'bg-gray-100 p-4 rounded-lg mb-4 overflow-x-auto' }, props.children),
      },
      children: processedContent
    })
  );
};

/**
 * Check if content should be treated as markdown (for longposts)
 */
export const isMarkdownContent = (postType: string | undefined): boolean => {
  return postType === 'longpost';
};

/**
 * Simple text formatter for non-markdown content
 */
export const formatPlainText = (content: string): string => {
  if (!content) return '';
  
  // Just handle line breaks for plain text
  return content.replace(/\n/g, '<br>');
};

/**
 * Get post type badge/tag styling and text
 */
export const getPostTypeInfo = (postType: string | undefined) => {
  switch (postType) {
    case 'longpost':
      return {
        text: 'Long Post',
        className: 'bg-blue-100 text-blue-800 border-blue-200'
      };
    case 'shitpost':
      return {
        text: 'Meme Post',
        className: 'bg-yellow-100 text-yellow-800 border-yellow-200'
      };
    case 'thread':
      return {
        text: 'Thread',
        className: 'bg-green-100 text-green-800 border-green-200'
      };
    default:
      return {
        text: 'Post',
        className: 'bg-gray-100 text-gray-800 border-gray-200'
      };
  }
}; 