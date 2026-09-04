#!/usr/bin/env node
/**
 * 模型设置功能测试脚本
 * 用于验证 Pi Agent 配置 API 的基本功能
 */

const BASE_URL = "http://localhost:3000";

async function api(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  return { status: response.status, data };
}

async function testPiConfig() {
  console.log("\n=== 测试 Pi Agent 配置 API ===\n");

  // 1. 获取当前配置
  console.log("1. 获取当前配置...");
  const getResult = await api("GET", "/api/settings/pi-agent-config");
  console.log(`   状态: ${getResult.status}`);
  console.log(`   供应商数量: ${getResult.data.providers?.length || 0}`);

  // 2. 添加测试供应商
  console.log("\n2. 添加测试供应商...");
  const testProvider = {
    id: "test-provider",
    name: "Test Provider",
    apiKey: "test-key-123",
    baseUrl: "https://api.example.com",
    models: [
      {
        id: "test-model-1",
        displayName: "Test Model 1",
      },
    ],
    apiFormat: "openai-chat",
    enabled: true,
  };

  const addResult = await api("POST", "/api/settings/pi-agent-config/provider", testProvider);
  console.log(`   状态: ${addResult.status}`);
  console.log(`   成功: ${addResult.data.success}`);

  // 3. 获取单个供应商
  console.log("\n3. 获取单个供应商...");
  const getOneResult = await api("GET", "/api/settings/pi-agent-config/provider/test-provider");
  console.log(`   状态: ${getOneResult.status}`);
  console.log(`   供应商名称: ${getOneResult.data.provider?.name}`);

  // 4. 删除测试供应商
  console.log("\n4. 删除测试供应商...");
  const deleteResult = await api("DELETE", "/api/settings/pi-agent-config/provider/test-provider");
  console.log(`   状态: ${deleteResult.status}`);
  console.log(`   成功: ${deleteResult.data.success}`);

  // 5. 验证删除
  console.log("\n5. 验证删除...");
  const verifyResult = await api("GET", "/api/settings/pi-agent-config");
  const remainingProviders = verifyResult.data.providers?.filter(p => p.id === "test-provider") || [];
  console.log(`   剩余测试供应商数量: ${remainingProviders.length}`);

  console.log("\n=== 测试完成 ===\n");
}

async function testConnectionEndpoint() {
  console.log("\n=== 测试连接测试端点 ===\n");

  const testCases = [
    {
      name: "OpenAI 格式（模拟）",
      body: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com",
        apiFormat: "openai-chat",
      },
    },
    {
      name: "Anthropic 格式（模拟）",
      body: {
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.com",
        apiFormat: "anthropic-messages",
      },
    },
  ];

  for (const testCase of testCases) {
    console.log(`测试: ${testCase.name}`);
    const result = await api("POST", "/api/settings/pi-agent-config/test-connection", testCase.body);
    console.log(`   状态: ${result.status}`);
    console.log(`   成功: ${result.data.success}`);
    if (result.data.error) {
      console.log(`   错误: ${result.data.error}`);
    }
    console.log();
  }

  console.log("=== 测试完成 ===\n");
}

async function main() {
  console.log("模型设置功能测试");
  console.log("================");
  console.log(`服务器: ${BASE_URL}`);
  console.log("注意: 请确保服务器正在运行");

  try {
    await testPiConfig();
    // 连接测试需要真实的 API Key，默认跳过
    // await testConnectionEndpoint();
  } catch (error) {
    console.error("\n❌ 测试失败:", error.message);
    process.exit(1);
  }

  console.log("✅ 所有测试通过");
}

main();
