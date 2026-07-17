import argparse
import concurrent.futures
import statistics
import time

import requests


def percentile(values, percent):
    if not values:
        return 0.0

    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round((percent / 100) * (len(ordered) - 1)))))
    return ordered[index]


def run_request(session, method, url, headers=None, params=None, json_body=None, timeout=10):
    started_at = time.perf_counter()
    try:
        response = session.request(
            method,
            url,
            headers=headers or {},
            params=params or {},
            json=json_body,
            timeout=timeout
        )
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        return {
            'ok': response.status_code == 200,
            'status_code': response.status_code,
            'elapsed_ms': elapsed_ms,
        }
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        return {
            'ok': False,
            'status_code': 'ERR',
            'elapsed_ms': elapsed_ms,
            'error': str(exc),
        }


def worker(base_url, method, endpoint, headers, iterations, timeout, request_builder, worker_index):
    session = requests.Session()
    results = []
    url = f"{base_url.rstrip('/')}{endpoint}"
    for iteration in range(iterations):
        request_args = request_builder(worker_index, iteration)
        results.append(run_request(
            session,
            method,
            url,
            headers=headers,
            params=request_args.get('params'),
            json_body=request_args.get('json'),
            timeout=timeout
        ))
    return results


def summarize_results(results, duration_s):
    latencies = [item['elapsed_ms'] for item in results]
    success_count = sum(1 for item in results if item['ok'])
    error_count = len(results) - success_count
    error_buckets = {}
    for item in results:
        if item['ok']:
            continue
        key = str(item.get('status_code'))
        error_buckets[key] = error_buckets.get(key, 0) + 1

    print(f"总请求数: {len(results)}")
    print(f"成功数: {success_count}")
    print(f"失败数: {error_count}")
    print(f"耗时: {duration_s:.2f}s")
    print(f"吞吐: {len(results) / duration_s:.2f} req/s" if duration_s > 0 else "吞吐: 0 req/s")
    print(f"平均耗时: {statistics.mean(latencies):.2f} ms" if latencies else "平均耗时: 0 ms")
    print(f"P50: {percentile(latencies, 50):.2f} ms")
    print(f"P95: {percentile(latencies, 95):.2f} ms")
    print(f"P99: {percentile(latencies, 99):.2f} ms")
    if error_buckets:
        print("失败分布:")
        for key, count in sorted(error_buckets.items()):
            print(f"  {key}: {count}")


def main():
    parser = argparse.ArgumentParser(description='Simple load tester for SecretBox APIs')
    parser.add_argument('--base-url', default='http://127.0.0.1:5000', help='API base URL, e.g. http://127.0.0.1:5000')
    parser.add_argument(
        '--scenario',
        choices=['square', 'teacher', 'post-public', 'post-private'],
        default='square',
        help='Load test scenario'
    )
    parser.add_argument('--token', default='', help='Authorization token for teacher or post scenarios')
    parser.add_argument('--concurrency', type=int, default=10, help='Number of parallel workers')
    parser.add_argument('--iterations', type=int, default=20, help='Requests per worker')
    parser.add_argument('--timeout', type=int, default=10, help='Per-request timeout in seconds')
    parser.add_argument('--page-size', type=int, default=20, help='Requested page size')
    parser.add_argument('--counselor-id', type=int, default=0, help='Counselor ID for private post scenario')
    args = parser.parse_args()

    method = 'GET'
    endpoint = '/api/questions'
    headers = {}
    request_builder = lambda worker_index, iteration: {
        'params': {
            'page': 1,
            'pageSize': args.page_size,
            'sort': 'time',
        }
    }

    if args.scenario == 'teacher':
        if not args.token:
            raise SystemExit('teacher 场景需要提供 --token')
        endpoint = '/api/teacher/questions'
        headers = {'Authorization': args.token}
        request_builder = lambda worker_index, iteration: {
            'params': {
                'scope': 'square',
                'reviewStatus': 'pending',
                'page': 1,
                'pageSize': args.page_size,
            }
        }
    elif args.scenario in {'post-public', 'post-private'}:
        if not args.token:
            raise SystemExit('发帖场景需要提供 --token')
        method = 'POST'
        headers = {'Authorization': args.token}
        is_public = args.scenario == 'post-public'

        def build_post_request(worker_index, iteration):
            unique_suffix = f"{worker_index}-{iteration}-{int(time.time() * 1000)}"
            return {
                'json': {
                    'content': f'[load-test] {args.scenario} {unique_suffix}',
                    'isAnonymous': True,
                    'isPublic': is_public,
                    'counselorId': 0 if is_public else args.counselor_id,
                }
            }

        request_builder = build_post_request

    started_at = time.perf_counter()
    all_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [
            executor.submit(
                worker,
                args.base_url,
                method,
                endpoint,
                headers,
                args.iterations,
                args.timeout,
                request_builder,
                worker_index,
            )
            for worker_index in range(args.concurrency)
        ]
        for future in concurrent.futures.as_completed(futures):
            all_results.extend(future.result())

    summarize_results(all_results, time.perf_counter() - started_at)


if __name__ == '__main__':
    main()
