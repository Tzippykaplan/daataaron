exports.handler = async (event) => {
  // Nedarim Plus callback endpoint.
  // In production, verify the callback source and update your dashboard record by Param1/orderRef.
  console.log('Nedarim callback method:', event.httpMethod);
  console.log('Nedarim callback headers:', event.headers);
  console.log('Nedarim callback body:', event.body);
  return { statusCode: 200, body: 'OK' };
};
