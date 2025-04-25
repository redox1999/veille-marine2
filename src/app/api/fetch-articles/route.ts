import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;
const serpApiKey = process.env.NEXT_PUBLIC_SERPAPI_KEY;

if (!supabaseUrl || !supabaseKey || !serpApiKey) {
  throw new Error('Missing required environment variables');
}

// Type assertion since we've already checked for undefined
const supabase = createClient(supabaseUrl as string, supabaseKey as string);

interface Article {
  title: string;
  link: string;
  snippet: string;
  date: string;
  source: string;
  created_at: string;
}

interface SerpApiNewsResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
  source?: {
    title?: string;
  } | string;
}

// Keywords to search in different languages
const keywords = {
  arabic: [
    "البحرية الملكية",
    "البحرية الملكية المغربية",
    "البحرية المغربية",
    "القوة البحرية المغربية",
    "سفينة حربية مغربية",
    "فرقاطة مغربية"
  ],
  french: [
    "La Marine royale",
    "La Marine Royale Marocaine",
    "La Marine marocaine",
    "L'Armée Navale Marocaine",
    "Force Navale Marocaine",
    "Navire de guerre marocain",
    "Frégate marocaine"
  ],
  spanish: [
    "la Marina Real",
    "la Marina Real Marroquí",
    "la Marina Marroquí",
    "las Fuerzas Navales Marroquíes",
    "la Fuerza Naval Marroquí",
    "buque de guerra marroquí",
    "fragata marroquí"
  ]
};

// Function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to create the articles table if it doesn't exist
async function createArticlesTable() {
  try {
    await response.json(); // remove unused variable
      .from('articles')
      .select('*')
      .limit(1);

    if (error) {
      // Create the table with proper schema
      const { error: createError } = await supabase.rpc('create_articles_table', {
        sql_query: `
          CREATE TABLE IF NOT EXISTS articles (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT,
            image_url TEXT,
            published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS articles_url_idx ON articles(url);
        `
      });

      if (createError) {
        console.error('Error creating table:', createError);
        throw createError;
      }
    }
  } catch (error) {
    console.error('Error ensuring table exists:', error);
    throw error;
  }
}

// Function to fetch articles from SerpAPI
async function fetchArticles(keyword: string, language: string): Promise<Article[]> {
  try {
    console.log(`Fetching articles for keyword: ${keyword} (${language})`);
    
    const url = new URL('https://serpapi.com/search');
    url.searchParams.append('api_key', serpApiKey as string);
    url.searchParams.append('q', keyword);
    url.searchParams.append('engine', 'google');
    url.searchParams.append('google_domain', 'google.com');
    url.searchParams.append('gl', 'ma'); // Morocco
    url.searchParams.append('hl', language === 'arabic' ? 'ar' : language === 'french' ? 'fr' : 'es');
    url.searchParams.append('tbm', 'nws'); // News search
    url.searchParams.append('tbs', 'qdr:d'); // Last 24 hours
    url.searchParams.append('num', '100'); // Maximum results

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SerpAPI error for "${keyword}":`, errorText);
      return [];
    }

    const data = await response.json();
    
    if (!data.news_results || !Array.isArray(data.news_results)) {
      console.warn(`No news results for "${keyword}"`);
      return [];
    }

    return data.news_results.map((article: SerpApiNewsResult): Article => ({
      title: article.title,
      link: article.link,
      snippet: article.snippet,
      date: article.date,
      source: typeof article.source === 'string' ? article.source : article.source?.title || 'Unknown',
      created_at: new Date().toISOString()
    }));
  } catch (error) {
    console.error(`Error fetching articles for keyword "${keyword}":`, error);
    return [];
  }
}

// Function to insert articles into Supabase
async function insertArticles(articles: Article[]) {
  if (articles.length === 0) {
    console.log('No articles to insert');
    return;
  }

  try {
    // Ensure the table exists with the correct schema
    await createArticlesTable();

    // Transform articles to match new schema
    const transformedArticles = articles.map(article => ({
      url: article.link,
      title: article.title,
      description: article.snippet,
      published_at: article.date ? new Date(article.date).toISOString() : new Date().toISOString(),
      created_at: new Date().toISOString()
    }));

    // Insert articles with upsert
    const { error } = await supabase
      .from('articles')
      .upsert(
        transformedArticles,
        {
          onConflict: 'url',
          ignoreDuplicates: true
        }
      );

    if (error) {
      console.error('Error inserting articles:', error);
      throw error;
    }

    console.log(`Successfully inserted ${articles.length} articles`);
  } catch (error) {
    console.error('Error in insertArticles:', error);
    throw error;
  }
}

export async function POST() {
  try {
    const allArticles: Article[] = [];
    
    // Process each language's keywords
    for (const [lang, langKeywords] of Object.entries(keywords)) {
      for (const keyword of langKeywords) {
        const articles = await fetchArticles(keyword, lang);
        if (articles.length > 0) {
          allArticles.push(...articles);
        }
        await delay(1000); // 1 second delay between requests
      }
    }

    if (allArticles.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No articles found'
      }, { status: 404 });
    }

    // Insert articles into Supabase
    await insertArticles(allArticles);

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${allArticles.length} articles`
    });
  } catch (error) {
    console.error('Error in fetch-articles route:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process articles',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 