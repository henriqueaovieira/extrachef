SELECT category, count(*)
FROM public.talent_connections
GROUP BY category
ORDER BY category;